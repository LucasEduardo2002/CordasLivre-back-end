import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { StringType } from '@prisma/client';

type WebSearchItem = {
  id: string;
  title: string;
  price: number | null;
  currency: string;
  source: string;
  permalink: string;
  thumbnail: string | null;
  instrumentType: StringType;
};

type WebSearchResponse = {
  query: string;
  instrumentType: StringType;
  cached: boolean;
  providers: string[];
  total: number;
  fetchedAt: string;
  results: WebSearchItem[];
};

@Injectable()
export class WebSearchService {
  private readonly logger = new Logger(WebSearchService.name);
  private readonly cache = new Map<string, { expiresAt: number; data: WebSearchResponse }>();
  private readonly cacheTtlMs = 1000 * 60 * 30;

  private resolveStringType(type?: string): StringType {
    if (!type) return StringType.VIOLAO;
    const normalized = type.toUpperCase();
    return Object.values(StringType).includes(normalized as StringType) ? (normalized as StringType) : StringType.VIOLAO;
  }

  private getTypeLabel(type: StringType): string {
    const labels: Record<StringType, string> = {
      [StringType.VIOLAO]: 'violão',
      [StringType.GUITARRA]: 'guitarra',
      [StringType.CONTRABAIXO]: 'contrabaixo',
      [StringType.CAVAQUINHO]: 'cavaquinho',
      [StringType.VIOLA_CAIPIRA]: 'viola caipira',
      [StringType.VIOLINO]: 'violino',
    };

    return labels[type] ?? 'instrumento de cordas';
  }

  private normalizeQuery(query: string): string {
    return query
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private parsePrice(input: unknown): number | null {
    if (typeof input === 'number' && Number.isFinite(input)) {
      return input;
    }

    if (typeof input !== 'string') {
      return null;
    }

    const normalized = input.replace(/[^\d,.-]/g, '').replace(/\.(?=.*\.)/g, '').replace(',', '.');
    const parsed = Number(normalized);

    return Number.isFinite(parsed) ? parsed : null;
  }

  private deduplicateAndSort(items: WebSearchItem[], limit: number): WebSearchItem[] {
    const dedupe = new Map<string, WebSearchItem>();

    for (const item of items) {
      const key = `${this.normalizeQuery(item.title)}|${item.source.toLowerCase()}`;
      if (!dedupe.has(key)) {
        dedupe.set(key, item);
      }
    }

    return Array.from(dedupe.values())
      .sort((a, b) => {
        if (a.price === null && b.price === null) return 0;
        if (a.price === null) return 1;
        if (b.price === null) return -1;
        return a.price - b.price;
      })
      .slice(0, limit);
  }

  private async fetchSerpApi(query: string, instrumentType: StringType, limit: number): Promise<WebSearchItem[]> {
    const apiKey = process.env.SERPAPI_KEY;
    if (!apiKey) {
      return [];
    }

    try {
      const { data } = await axios.get('https://serpapi.com/search.json', {
        timeout: 20000,
        params: {
          engine: 'google_shopping',
          q: query,
          api_key: apiKey,
          gl: 'br',
          hl: 'pt-br',
          num: Math.min(Math.max(limit, 5), 25),
        },
      });

      const shoppingResults = Array.isArray(data?.shopping_results) ? data.shopping_results : [];

      return shoppingResults
        .map((item: any, index: number) => {
          const extractedPrice = this.parsePrice(item?.extracted_price ?? item?.price);
          const permalink = String(item?.link ?? item?.product_link ?? '').trim();
          const title = String(item?.title ?? '').trim();

          if (!title || !permalink) {
            return null;
          }

          return {
            id: `serp-${index}-${Buffer.from(title).toString('base64').slice(0, 12)}`,
            title,
            price: extractedPrice,
            currency: String(item?.currency ?? 'BRL').trim() || 'BRL',
            source: String(item?.source ?? item?.merchant ?? 'Web').trim() || 'Web',
            permalink,
            thumbnail: String(item?.thumbnail ?? item?.thumbnails?.[0] ?? '').trim() || null,
            instrumentType,
          } as WebSearchItem;
        })
        .filter((item: WebSearchItem | null): item is WebSearchItem => item !== null);
    } catch (error) {
      this.logger.warn(`Falha na busca SerpAPI: ${error?.message || error}`);
      return [];
    }
  }

  private async fetchMercadoLivre(query: string, instrumentType: StringType, limit: number): Promise<WebSearchItem[]> {
    try {
      const { data } = await axios.get('https://api.mercadolibre.com/sites/MLB/search', {
        timeout: 20000,
        params: {
          q: query,
          limit: Math.min(Math.max(limit, 5), 50),
          sort: 'price_asc',
        },
      });

      const results = Array.isArray(data?.results) ? data.results : [];

      return results
        .map((item: any) => {
          const title = String(item?.title ?? '').trim();
          const permalink = String(item?.permalink ?? '').trim();

          if (!title || !permalink) {
            return null;
          }

          return {
            id: `ml-${String(item?.id ?? '').trim() || Math.random().toString(36).slice(2)}`,
            title,
            price: this.parsePrice(item?.price),
            currency: String(item?.currency_id ?? 'BRL').trim() || 'BRL',
            source: 'Mercado Livre',
            permalink,
            thumbnail: String(item?.thumbnail ?? '').trim() || null,
            instrumentType,
          } as WebSearchItem;
        })
        .filter((item: WebSearchItem | null): item is WebSearchItem => item !== null);
    } catch (error) {
      this.logger.warn(`Falha na busca Mercado Livre: ${error?.message || error}`);
      return [];
    }
  }

  async searchWeb(params: { q?: string; type?: string; limit?: number }): Promise<WebSearchResponse> {
    const instrumentType = this.resolveStringType(params.type);
    const requestedLimit = Number(params.limit ?? 20);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.floor(requestedLimit), 5), 40) : 20;

    const rawQuery = String(params.q ?? '').trim();
    const fallbackQuery = `encordoamento ${this.getTypeLabel(instrumentType)}`;
    const query = rawQuery || fallbackQuery;

    if (query.length < 3) {
      throw new BadRequestException('Use uma busca com pelo menos 3 caracteres.');
    }

    const cacheKey = `${instrumentType}:${this.normalizeQuery(query)}:${limit}`;
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return {
        ...cached.data,
        cached: true,
      };
    }

    const providers: string[] = [];

    const [serpApiResults, mercadoLivreResults] = await Promise.all([
      this.fetchSerpApi(query, instrumentType, limit),
      this.fetchMercadoLivre(query, instrumentType, limit),
    ]);

    if (serpApiResults.length > 0) {
      providers.push('SerpAPI');
    }

    if (mercadoLivreResults.length > 0) {
      providers.push('Mercado Livre');
    }

    const merged = this.deduplicateAndSort([...serpApiResults, ...mercadoLivreResults], limit);

    const response: WebSearchResponse = {
      query,
      instrumentType,
      cached: false,
      providers: providers.length > 0 ? providers : ['Mercado Livre'],
      total: merged.length,
      fetchedAt: new Date().toISOString(),
      results: merged,
    };

    this.cache.set(cacheKey, {
      data: response,
      expiresAt: Date.now() + this.cacheTtlMs,
    });

    return response;
  }
}
