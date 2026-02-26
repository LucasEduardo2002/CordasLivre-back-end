import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { PrismaService } from '../../prisma/prisma.service';
import { Cron } from '@nestjs/schedule';
import { StringType } from '@prisma/client';

type CatalogProduct = {
  mlId: string;
  title: string;
  price: number;
  thumbnail: string;
  permalink: string;
  ratingAvg: number | null;
  ratingCount: number;
  rankingScore?: number;
};

type AiReviewPayload = {
  title: string;
  price: number;
  ratingAvg: number | null;
  ratingCount: number;
  type: StringType;
  permalink?: string;
};

type AiReviewResult = {
  title: string;
  summary: string;
  pros: string[];
  attentionPoints: string[];
  verdict: string;
  confidence: 'baixa' | 'media' | 'alta';
  generatedAt: string;
};

@Injectable()
export class StringsSyncService {
  private readonly logger = new Logger(StringsSyncService.name);
  private readonly LEGACY_CATEGORY_ID = 'MLB278076';
  private syncInFlight: Promise<{ status: string; total: number; categories: Array<{ type: StringType; label: string; total: number }> }> | null = null;
  private readonly itemRatingsCache = new Map<string, { ratingAvg: number | null; ratingCount: number }>();
  private readonly stringCategories = [
    { type: StringType.VIOLAO, label: 'Violão', categoryId: 'MLB278076', query: 'encordoamento violão' },
    { type: StringType.GUITARRA, label: 'Guitarra', categoryId: 'MLB438183', query: 'encordoamento guitarra' },
    { type: StringType.CONTRABAIXO, label: 'Contrabaixo', categoryId: 'MLB438182', query: 'encordoamento baixo' },
    { type: StringType.CAVAQUINHO, label: 'Cavaquinho', query: 'encordoamento cavaquinho' },
    { type: StringType.VIOLA_CAIPIRA, label: 'Viola Caipira', query: 'encordoamento viola caipira' },
    { type: StringType.VIOLINO, label: 'Violino', query: 'encordoamento violino' },
  ];

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

  private normalizeAiReviewPayload(input: {
    title?: string;
    price?: number;
    ratingAvg?: number | null;
    ratingCount?: number;
    type?: string;
    permalink?: string;
  }): AiReviewPayload {
    const title = String(input?.title ?? '').trim();
    if (!title) {
      throw new BadRequestException('Título do produto é obrigatório para gerar avaliação IA.');
    }

    const parsedPrice = Number(input?.price ?? 0);
    const price = Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : 0;

    const parsedRatingAvg = Number(input?.ratingAvg);
    const ratingAvg =
      input?.ratingAvg === null
        ? null
        : Number.isFinite(parsedRatingAvg)
          ? Math.max(0, Math.min(5, parsedRatingAvg))
          : null;

    const parsedRatingCount = Number(input?.ratingCount ?? 0);
    const ratingCount = Number.isFinite(parsedRatingCount) && parsedRatingCount > 0 ? Math.floor(parsedRatingCount) : 0;

    return {
      title,
      price,
      ratingAvg,
      ratingCount,
      type: this.resolveStringType(input?.type),
      permalink: String(input?.permalink ?? '').trim() || undefined,
    };
  }

  private buildLocalAiReview(payload: AiReviewPayload): AiReviewResult {
    const instrumentLabel = this.getTypeLabel(payload.type);
    const hasRating = payload.ratingAvg !== null;
    const ratingText = hasRating
      ? `${payload.ratingAvg?.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}/5`
      : 'sem nota consolidada';

    const confidence: AiReviewResult['confidence'] =
      payload.ratingCount >= 120 ? 'alta' : payload.ratingCount >= 30 ? 'media' : 'baixa';

    const valueBand = payload.price <= 70 ? 'entrada' : payload.price <= 180 ? 'intermediário' : 'premium';

    const pros = [
      hasRating
        ? `Recepção do público positiva (${ratingText} com ${payload.ratingCount.toLocaleString('pt-BR')} avaliações).`
        : 'Produto ativo no marketplace com dados suficientes para comparação de preço e posicionamento.',
      `Faixa de valor classificada como ${valueBand}, útil para quem busca custo-benefício em ${instrumentLabel}.`,
      'Link direto para compra no Mercado Livre, agilizando a decisão final.',
    ];

    const attentionPoints = [
      'Verifique calibre, material e tensão no anúncio para garantir compatibilidade com seu instrumento.',
      'Confirme reputação do vendedor e prazo de entrega antes de concluir.',
    ];

    if (payload.ratingCount < 10) {
      attentionPoints.push('Amostra de avaliações ainda pequena; trate a nota como referência inicial.');
    }

    const summary = hasRating
      ? `Com base no histórico de avaliações (${ratingText}) e no volume de feedback (${payload.ratingCount.toLocaleString(
          'pt-BR',
        )}), este item aparece como uma opção competitiva para ${instrumentLabel}.`
      : `Ainda sem nota consolidada do marketplace, mas o produto entra como alternativa para ${instrumentLabel} com base em relevância e preço.`;

    const safeRating = payload.ratingAvg ?? 0;

    const verdict = hasRating
      ? safeRating >= 4.7
        ? 'Indicação forte para compra, principalmente se o anúncio confirmar o calibre ideal para seu uso.'
        : safeRating >= 4.3
          ? 'Boa opção de compra para uso geral, com atenção aos detalhes técnicos do encordoamento.'
          : 'Opção viável, mas vale comparar com itens de nota mais alta antes de decidir.'
      : 'Sem nota consolidada: recomendado comparar com 2-3 opções avaliadas antes de finalizar a compra.';

    return {
      title: payload.title,
      summary,
      pros,
      attentionPoints,
      verdict,
      confidence,
      generatedAt: new Date().toISOString(),
    };
  }

  private async generateReviewWithOpenAi(payload: AiReviewPayload): Promise<AiReviewResult | null> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return null;
    }

    try {
      const instrumentLabel = this.getTypeLabel(payload.type);
      const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

      const { data } = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model,
          temperature: 0.6,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'Você é um analista de produtos musicais. Gere uma análise curta, clara e honesta em português do Brasil. Responda somente JSON válido com: summary (string), pros (array de 3 strings), attentionPoints (array de 2 ou 3 strings), verdict (string), confidence (baixa|media|alta).',
            },
            {
              role: 'user',
              content: `Produto: ${payload.title}\nInstrumento: ${instrumentLabel}\nPreço: R$ ${payload.price.toFixed(
                2,
              )}\nNota média: ${payload.ratingAvg ?? 'sem nota'}\nQuantidade de avaliações: ${payload.ratingCount}`,
            },
          ],
        },
        {
          timeout: 20000,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        return null;
      }

      const parsed = JSON.parse(content);
      const confidenceRaw = String(parsed?.confidence ?? '').toLowerCase();
      const confidence: AiReviewResult['confidence'] =
        confidenceRaw === 'alta' || confidenceRaw === 'media' || confidenceRaw === 'baixa'
          ? confidenceRaw
          : 'media';

      return {
        title: payload.title,
        summary: String(parsed?.summary ?? '').trim() || 'Análise gerada por IA indisponível no momento.',
        pros: Array.isArray(parsed?.pros)
          ? parsed.pros.map((item) => String(item)).filter(Boolean).slice(0, 3)
          : [],
        attentionPoints: Array.isArray(parsed?.attentionPoints)
          ? parsed.attentionPoints.map((item) => String(item)).filter(Boolean).slice(0, 3)
          : [],
        verdict: String(parsed?.verdict ?? '').trim() || 'Compare com outros anúncios antes de concluir a compra.',
        confidence,
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.warn(`OpenAI indisponível para avaliação IA: ${error?.message || error}`);
      return null;
    }
  }

  async generateAiReview(input: {
    title?: string;
    price?: number;
    ratingAvg?: number | null;
    ratingCount?: number;
    type?: string;
    permalink?: string;
  }) {
    const payload = this.normalizeAiReviewPayload(input);
    const openAiResult = await this.generateReviewWithOpenAi(payload);
    const review = openAiResult ?? this.buildLocalAiReview(payload);

    return {
      product: {
        title: payload.title,
        price: payload.price,
        ratingAvg: payload.ratingAvg,
        ratingCount: payload.ratingCount,
        type: payload.type,
        permalink: payload.permalink,
      },
      review,
    };
  }

  private buildAffiliatePermalink(baseUrl: string, affiliateTag: string): string {
    const url = new URL(baseUrl);
    url.searchParams.set('matt_tool', affiliateTag);
    return url.toString();
  }

  private resolveStringType(type?: string): StringType {
    if (!type) return StringType.VIOLAO;
    const normalized = type.toUpperCase();
    return Object.values(StringType).includes(normalized as StringType) ? (normalized as StringType) : StringType.VIOLAO;
  }

  private normalizeText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private matchesTypeByTitle(title: string, type: StringType): boolean {
    const normalizedTitle = this.normalizeText(title);
    const keywordsByType: Record<StringType, string[]> = {
      [StringType.VIOLAO]: ['violao', 'acustica', 'acustico'],
      [StringType.GUITARRA]: ['guitarra'],
      [StringType.CONTRABAIXO]: ['contrabaixo', 'baixo', 'bass'],
      [StringType.CAVAQUINHO]: ['cavaquinho', 'cavaco'],
      [StringType.VIOLA_CAIPIRA]: ['viola caipira', 'caipira'],
      [StringType.VIOLINO]: ['violino'],
    };

    const keywords = keywordsByType[type] ?? [];
    return keywords.some((keyword) => normalizedTitle.includes(keyword));
  }

  private matchesTypeByAttributes(attributes: unknown, type: StringType): boolean {
    if (!Array.isArray(attributes)) return false;
    const instrumentAttribute = attributes.find((attribute) => attribute?.id === 'RECOMMENDED_INSTRUMENT');
    if (!instrumentAttribute) return false;

    const valueName = this.normalizeText(instrumentAttribute.value_name ?? '');
    if (!valueName) return false;

    const acceptedByType: Record<StringType, string[]> = {
      [StringType.VIOLAO]: ['violao', 'acustico'],
      [StringType.GUITARRA]: ['guitarra'],
      [StringType.CONTRABAIXO]: ['contrabaixo', 'baixo', 'bass'],
      [StringType.CAVAQUINHO]: ['cavaquinho', 'cavaco'],
      [StringType.VIOLA_CAIPIRA]: ['viola caipira', 'sertaneja', '10 cordas'],
      [StringType.VIOLINO]: ['violino'],
    };

    const expectedTokens = acceptedByType[type] ?? [];
    return expectedTokens.some((token) => valueName.includes(token));
  }

  private getStrictQueriesByType(type: StringType): string[] {
    const queriesByType: Record<StringType, string[]> = {
      [StringType.VIOLAO]: [
        'encordoamento violao',
        'corda violao',
        'jogo cordas violao',
      ],
      [StringType.GUITARRA]: [
        'encordoamento guitarra',
        'corda guitarra',
        'jogo cordas guitarra',
      ],
      [StringType.CONTRABAIXO]: [
        'encordoamento baixo',
        'corda contrabaixo',
        'jogo cordas baixo',
      ],
      [StringType.CAVAQUINHO]: [
        'encordoamento cavaquinho',
        'corda cavaquinho',
        'jogo cordas cavaco',
      ],
      [StringType.VIOLA_CAIPIRA]: [
        'encordoamento viola caipira',
        'corda viola caipira',
        'jogo cordas viola sertaneja',
      ],
      [StringType.VIOLINO]: [
        'encordoamento violino',
        'corda violino',
        'jogo cordas violino',
      ],
    };

    return queriesByType[type] ?? [];
  }

  private mergeCatalogProducts(target: Map<string, CatalogProduct>, incoming: CatalogProduct[], limit: number): void {
    for (const item of incoming) {
      if (target.size >= limit) break;
      if (!target.has(item.mlId)) {
        target.set(item.mlId, item);
      }
    }
  }

  private getRatingFromReviewsPayload(payload: any): { ratingAvg: number | null; ratingCount: number } {
    const ratingAvgRaw = payload?.rating_average;
    const ratingAvg = Number.isFinite(Number(ratingAvgRaw)) ? Number(ratingAvgRaw) : null;

    const ratingCountRaw = payload?.paging?.total;
    const ratingCount = Number.isFinite(Number(ratingCountRaw)) ? Number(ratingCountRaw) : 0;

    return { ratingAvg, ratingCount };
  }

  private async fetchItemRating(itemId: string): Promise<{ ratingAvg: number | null; ratingCount: number }> {
    const cached = this.itemRatingsCache.get(itemId);
    if (cached) return cached;

    try {
      const { data } = await this.mlApi.get(`/reviews/item/${itemId}`);
      const rating = this.getRatingFromReviewsPayload(data);
      this.itemRatingsCache.set(itemId, rating);
      return rating;
    } catch {
      const emptyRating = { ratingAvg: null, ratingCount: 0 };
      this.itemRatingsCache.set(itemId, emptyRating);
      return emptyRating;
    }
  }

  private computeRankingScore(
    item: CatalogProduct,
    basePosition: number,
    totalItems: number,
    bayesianMeanRating: number,
    maxRatingCount: number,
    minReviewsForConfidence: number,
  ): number {
    const ratingCount = item.ratingCount;
    const effectiveRating = item.ratingAvg ?? bayesianMeanRating;

    const bayesianRating =
      (ratingCount / (ratingCount + minReviewsForConfidence)) * effectiveRating +
      (minReviewsForConfidence / (ratingCount + minReviewsForConfidence)) * bayesianMeanRating;

    const ratingNormalized = Math.max(0, Math.min(1, bayesianRating / 5));
    const volumeNormalized =
      maxRatingCount > 0 ? Math.log10(ratingCount + 1) / Math.log10(maxRatingCount + 1) : 0;
    const baseNormalized = totalItems > 1 ? 1 - basePosition / (totalItems - 1) : 1;

    return ratingNormalized * 70 + volumeNormalized * 25 + baseNormalized * 5;
  }

  private async applyRatingAndSort(items: CatalogProduct[]): Promise<CatalogProduct[]> {
    const enriched: CatalogProduct[] = [];

    for (const item of items) {
      const rating = await this.fetchItemRating(item.mlId);
      enriched.push({
        ...item,
        ratingAvg: rating.ratingAvg,
        ratingCount: rating.ratingCount,
      });
    }

    const ratedItems = enriched.filter((item) => item.ratingAvg !== null && item.ratingCount > 0);
    const bayesianMeanRating =
      ratedItems.length > 0
        ? ratedItems.reduce((sum, item) => sum + (item.ratingAvg ?? 0), 0) / ratedItems.length
        : 4;
    const maxRatingCount = enriched.reduce((max, item) => Math.max(max, item.ratingCount), 0);
    const minReviewsForConfidence = 15;

    const scored = enriched.map((item, index) => ({
      ...item,
      originalIndex: index,
      rankingScore: this.computeRankingScore(
        item,
        index,
        enriched.length,
        bayesianMeanRating,
        maxRatingCount,
        minReviewsForConfidence,
      ),
    }));

    scored.sort((a, b) => {
      const scoreDiff = (b.rankingScore ?? 0) - (a.rankingScore ?? 0);
      if (scoreDiff !== 0) return scoreDiff;

      const ratingDiff = (b.ratingAvg ?? 0) - (a.ratingAvg ?? 0);
      if (ratingDiff !== 0) return ratingDiff;

      const countDiff = b.ratingCount - a.ratingCount;
      if (countDiff !== 0) return countDiff;

      return a.originalIndex - b.originalIndex;
    });

    return scored.map(({ originalIndex, ...item }) => item);
  }

  private async fetchProductsStrict(affiliateTag: string, type: StringType, limit: number): Promise<CatalogProduct[]> {
    const queries = this.getStrictQueriesByType(type);
    const expandedLimit = 50;
    const collected = new Map<string, CatalogProduct>();

    for (const query of queries) {
      if (collected.size >= limit) break;

      let data: any;
      try {
        const response = await this.mlApi.get('/products/search', {
          params: {
            site_id: 'MLB',
            q: query,
            limit: expandedLimit,
          },
        });
        data = response.data;
      } catch (error) {
        this.logger.warn(`Strict mode: products/search falhou para "${query}": ${error?.message || error}`);
        continue;
      }

      const results = Array.isArray(data?.results) ? data.results : [];
      for (const product of results) {
        if (collected.size >= limit) break;

        const productId = product?.id;
        const title = product?.name;
        if (!productId || !title) continue;

        if (!this.matchesTypeByAttributes(product?.attributes, type)) continue;

        try {
          const { data: productItemsData } = await this.mlApi.get(`/products/${productId}/items`);
          const productItems = Array.isArray(productItemsData?.results) ? productItemsData.results : [];
          const firstItem = productItems.find((item) => Number.isFinite(Number(item?.price)) && Number(item?.price) > 0);
          if (!firstItem) continue;

          const image =
            product?.pictures?.[0]?.url ||
            product?.pictures?.[0]?.secure_url ||
            firstItem?.thumbnail ||
            '';
          if (!image) continue;

          const basePermalink = firstItem?.permalink || `https://www.mercadolivre.com.br/p/${productId}`;
          const catalogItem: CatalogProduct = {
            mlId: firstItem?.item_id || productId,
            title,
            price: Number(firstItem.price),
            thumbnail: image,
            permalink: this.buildAffiliatePermalink(basePermalink, affiliateTag),
            ratingAvg: null,
            ratingCount: 0,
          };

          collected.set(catalogItem.mlId, catalogItem);
        } catch (error) {
          this.logger.debug(`Strict mode: falha ao montar item ${productId}: ${error?.message || error}`);
        }
      }
    }

    return Array.from(collected.values()).slice(0, limit);
  }

  private getSellerId(): string | null {
    const sellerId = process.env.ML_SELLER_ID ?? process.env.ML_USER_ID;
    if (!sellerId) return null;
    return sellerId.trim() || null;
  }

  private async fetchProductsFromUserItems(affiliateTag: string, limit: number, type: StringType): Promise<CatalogProduct[]> {
    const sellerId = this.getSellerId();
    if (!sellerId) {
      this.logger.warn('Fallback via /users/{id}/items/search ignorado: ML_SELLER_ID/ML_USER_ID não configurado.');
      return [];
    }

    const expandedLimit = Math.max(limit * 5, 30);

    const { data: itemsSearchData } = await this.mlApi.get(`/users/${sellerId}/items/search`, {
      params: { limit: expandedLimit },
    });

    const itemIds = ((itemsSearchData?.results as unknown[]) || [])
      .map((item) => (typeof item === 'string' ? item : null))
      .filter((itemId): itemId is string => Boolean(itemId));

    if (itemIds.length === 0) {
      return [];
    }

    const idsParam = itemIds.slice(0, expandedLimit).join(',');
    const { data: detailsData } = await this.mlApi.get('/items', {
      params: { ids: idsParam },
    });

    const detailsArray = Array.isArray(detailsData) ? detailsData : [];
    const catalog: CatalogProduct[] = [];

    for (const entry of detailsArray) {
      const item = entry?.body ?? entry;
      if (!item?.id || !item?.title || item?.price === undefined || !item?.thumbnail || !item?.permalink) continue;
      catalog.push({
        mlId: item.id,
        title: item.title,
        price: item.price,
        thumbnail: item.thumbnail,
        permalink: this.buildAffiliatePermalink(item.permalink, affiliateTag),
        ratingAvg: null,
        ratingCount: 0,
      });
    }

    const filteredCatalog = catalog.filter((item) => this.matchesTypeByTitle(item.title, type));
    return filteredCatalog.slice(0, limit);
  }

  private async fetchProductsFromHighlights(
    affiliateTag: string,
    type: StringType,
    limit: number,
    categoryId?: string,
  ): Promise<CatalogProduct[]> {
    const highlightCategoryId = categoryId ?? this.LEGACY_CATEGORY_ID;
    const { data } = await this.mlApi.get(`/highlights/MLB/category/${highlightCategoryId}`);
    const content = Array.isArray(data?.content) ? data.content : [];
    const products: CatalogProduct[] = [];

    for (const entry of content) {
      if (products.length >= limit) break;
      if (entry?.type !== 'PRODUCT' || !entry?.id) continue;

      try {
        const { data: productData } = await this.mlApi.get(`/products/${entry.id}`);
        const productTitle = productData?.name || productData?.family_name || '';
        if (!productTitle || !this.matchesTypeByTitle(productTitle, type)) continue;

        const { data: productItemsData } = await this.mlApi.get(`/products/${entry.id}/items`);
        const productItems = Array.isArray(productItemsData?.results) ? productItemsData.results : [];
        const firstItem = productItems[0];
        const price = Number(firstItem?.price);
        if (!Number.isFinite(price) || price <= 0) continue;

        const thumbnail = productData?.pictures?.[0]?.url || productData?.pictures?.[0]?.secure_url || '';
        if (!thumbnail) continue;

        const basePermalink =
          firstItem?.permalink ||
          productData?.permalink ||
          `https://www.mercadolivre.com.br/p/${productData?.id || entry.id}`;

        products.push({
          mlId: firstItem?.item_id || productData?.id || entry.id,
          title: productTitle,
          price,
          thumbnail,
          permalink: this.buildAffiliatePermalink(basePermalink, affiliateTag),
          ratingAvg: null,
          ratingCount: 0,
        });
      } catch (productError) {
        this.logger.debug(`Falha no fallback highlights para ${entry?.id}: ${productError?.message || productError}`);
      }
    }

    return products.slice(0, limit);
  }

  private async fetchProductsFromProductSearch(
    affiliateTag: string,
    type: StringType,
    searchQuery: string,
    limit: number,
  ): Promise<CatalogProduct[]> {
    const expandedLimit = Math.min(50, Math.max(limit * 4, 30));
    const { data } = await this.mlApi.get('/products/search', {
      params: {
        site_id: 'MLB',
        q: searchQuery,
        limit: expandedLimit,
      },
    });

    const results = Array.isArray(data?.results) ? data.results : [];
    const collected = new Map<string, CatalogProduct>();

    for (const product of results) {
      if (collected.size >= limit) break;
      const productId = product?.id;
      const title = product?.name;
      if (!productId || !title) continue;

      const attributeMatch = this.matchesTypeByAttributes(product?.attributes, type);
      const titleMatch = this.matchesTypeByTitle(title, type);
      if (!attributeMatch && !titleMatch) continue;

      try {
        const { data: productItemsData } = await this.mlApi.get(`/products/${productId}/items`);
        const productItems = Array.isArray(productItemsData?.results) ? productItemsData.results : [];
        const firstItem = productItems.find((item) => Number.isFinite(Number(item?.price)) && Number(item?.price) > 0);
        if (!firstItem) continue;

        const image =
          product?.pictures?.[0]?.url ||
          product?.pictures?.[0]?.secure_url ||
          firstItem?.thumbnail ||
          '';
        if (!image) continue;

        const basePermalink = firstItem?.permalink || `https://www.mercadolivre.com.br/p/${productId}`;
        const catalogItem: CatalogProduct = {
          mlId: firstItem?.item_id || productId,
          title,
          price: Number(firstItem.price),
          thumbnail: image,
          permalink: this.buildAffiliatePermalink(basePermalink, affiliateTag),
          ratingAvg: null,
          ratingCount: 0,
        };

        collected.set(catalogItem.mlId, catalogItem);
      } catch (error) {
        this.logger.debug(`Falha em products/search fallback para ${productId}: ${error?.message || error}`);
      }
    }

    return Array.from(collected.values()).slice(0, limit);
  }

  private async fetchProductsBySearch(
    affiliateTag: string,
    searchQuery: string,
    type: StringType,
    limit: number = 20,
    categoryId?: string,
  ): Promise<CatalogProduct[]> {
    const strictMode = (process.env.ML_STRICT_MODE ?? 'false').toLowerCase() === 'true';
    const strictSeed = new Map<string, CatalogProduct>();

    if (strictMode) {
      const strictCatalog = await this.fetchProductsStrict(affiliateTag, type, Math.min(limit, 10));
      if (strictCatalog.length >= 10) {
        this.logger.log(`Strict mode ativo para "${searchQuery}" (${strictCatalog.length} itens).`);
        return strictCatalog;
      }

      if (strictCatalog.length > 0) {
        this.mergeCatalogProducts(strictSeed, strictCatalog, 10);
        this.logger.log(
          `Strict mode ativo para "${searchQuery}" (${strictCatalog.length} itens). Buscando complementos via fallback.`,
        );
      } else {
        this.logger.warn(`Strict mode não encontrou itens para "${searchQuery}". Tentando fallback padrão.`);
      }
    }

    try {
      const { data } = await this.mlApi.get('/sites/MLB/search', {
        params: { q: searchQuery, category: categoryId, limit, sort: 'relevance' },
      });
      const catalog: CatalogProduct[] = [];
      for (const item of (data.results || []).slice(0, limit)) {
        if (!item?.id || !item?.title || item?.price === undefined || !item?.thumbnail || !item?.permalink) continue;
        catalog.push({
          mlId: item.id,
          title: item.title,
          price: item.price,
          thumbnail: item.thumbnail,
          permalink: this.buildAffiliatePermalink(item.permalink, affiliateTag),
          ratingAvg: null,
          ratingCount: 0,
        });
      }

      if (strictSeed.size > 0) {
        this.mergeCatalogProducts(strictSeed, catalog, 10);
        return Array.from(strictSeed.values()).slice(0, 10);
      }

      return catalog;
    } catch (error) {
      if (error instanceof AxiosError && error.response?.status === 403) {
        const responseData = JSON.stringify(error.response?.data ?? {});
        this.logger.warn(`403 em search (${searchQuery}) cat=${categoryId ?? 'none'} payload=${responseData}`);
        try {
          const { data } = await axios.get('https://api.mercadolibre.com/sites/MLB/search', {
            params: { q: searchQuery, category: categoryId, limit, sort: 'relevance' },
            headers: {
              Accept: 'application/json',
              'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
              'Cache-Control': 'no-cache',
              Pragma: 'no-cache',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
              Referer: 'https://www.mercadolivre.com.br/',
              Origin: 'https://www.mercadolivre.com.br',
            },
            timeout: 10000,
          });

          const fallbackCatalog: CatalogProduct[] = [];
          for (const item of (data.results || []).slice(0, limit)) {
            if (!item?.id || !item?.title || item?.price === undefined || !item?.thumbnail || !item?.permalink) continue;
            fallbackCatalog.push({
              mlId: item.id,
              title: item.title,
              price: item.price,
              thumbnail: item.thumbnail,
              permalink: this.buildAffiliatePermalink(item.permalink, affiliateTag),
              ratingAvg: null,
              ratingCount: 0,
            });
          }

          if (strictSeed.size > 0) {
            this.mergeCatalogProducts(strictSeed, fallbackCatalog, 10);
            if (strictSeed.size >= 10) {
              return Array.from(strictSeed.values()).slice(0, 10);
            }
          } else if (fallbackCatalog.length > 0) {
            return fallbackCatalog;
          }

          return fallbackCatalog;
        } catch (fallbackError) {
          if (fallbackError instanceof AxiosError) {
            const fallbackPayload = JSON.stringify(fallbackError.response?.data ?? {});
            this.logger.warn(`Fallback sem token falhou para "${searchQuery}": status=${fallbackError.response?.status} payload=${fallbackPayload}`);
          } else {
            this.logger.warn(`Fallback sem token falhou para "${searchQuery}": ${fallbackError?.message || fallbackError}`);
          }
        }

        try {
          const sellerFallbackCatalog = await this.fetchProductsFromUserItems(affiliateTag, limit, type);
          if (sellerFallbackCatalog.length > 0) {
            if (strictSeed.size > 0) {
              this.mergeCatalogProducts(strictSeed, sellerFallbackCatalog, 10);
              if (strictSeed.size >= 10) {
                this.logger.log(
                  `Fallback via seller items complementou strict para "${searchQuery}" (${strictSeed.size} itens).`,
                );
                return Array.from(strictSeed.values()).slice(0, 10);
              }
            } else {
              this.logger.log(`Fallback via seller items usado para "${searchQuery}" (${sellerFallbackCatalog.length} itens).`);
              return sellerFallbackCatalog;
            }
            this.logger.log(`Fallback via seller items usado para "${searchQuery}" (${sellerFallbackCatalog.length} itens).`);
          }
          this.logger.warn(`Fallback via seller items não retornou resultados para "${searchQuery}".`);
        } catch (sellerFallbackError) {
          this.logger.warn(
            `Fallback via seller items falhou para "${searchQuery}": ${sellerFallbackError?.message || sellerFallbackError}`,
          );
        }

        try {
          const productsSearchFallbackCatalog = await this.fetchProductsFromProductSearch(
            affiliateTag,
            type,
            searchQuery,
            limit,
          );
          if (productsSearchFallbackCatalog.length > 0) {
            if (strictSeed.size > 0) {
              this.mergeCatalogProducts(strictSeed, productsSearchFallbackCatalog, 10);
              if (strictSeed.size >= 10) {
                this.logger.log(
                  `Fallback via products/search complementou strict para "${searchQuery}" (${strictSeed.size} itens).`,
                );
                return Array.from(strictSeed.values()).slice(0, 10);
              }
            } else {
              this.logger.log(
                `Fallback via products/search usado para "${searchQuery}" (${productsSearchFallbackCatalog.length} itens).`,
              );
              return productsSearchFallbackCatalog;
            }
            this.logger.log(
              `Fallback via products/search usado para "${searchQuery}" (${productsSearchFallbackCatalog.length} itens).`,
            );
          }
          this.logger.warn(`Fallback via products/search não retornou resultados para "${searchQuery}".`);
        } catch (productsSearchError) {
          this.logger.warn(
            `Fallback via products/search falhou para "${searchQuery}": ${productsSearchError?.message || productsSearchError}`,
          );
        }

        try {
          const highlightsFallbackCatalog = await this.fetchProductsFromHighlights(affiliateTag, type, limit, categoryId);
          if (highlightsFallbackCatalog.length > 0) {
            if (strictSeed.size > 0) {
              this.mergeCatalogProducts(strictSeed, highlightsFallbackCatalog, 10);
              if (strictSeed.size > 0) {
                this.logger.log(
                  `Fallback via highlights complementou strict para "${searchQuery}" (${strictSeed.size} itens).`,
                );
                return Array.from(strictSeed.values()).slice(0, 10);
              }
            }

            this.logger.log(`Fallback via highlights usado para "${searchQuery}" (${highlightsFallbackCatalog.length} itens).`);
            return highlightsFallbackCatalog;
          }
          this.logger.warn(`Fallback via highlights não retornou resultados para "${searchQuery}".`);
        } catch (highlightsFallbackError) {
          this.logger.warn(
            `Fallback via highlights falhou para "${searchQuery}": ${highlightsFallbackError?.message || highlightsFallbackError}`,
          );
        }
      }
      this.logger.warn(`Falha ao buscar "${searchQuery}": ${error?.message || error}`);
      if (strictSeed.size > 0) {
        return Array.from(strictSeed.values()).slice(0, 10);
      }
      return [];
    }
  }

  private readonly mlApi = axios.create({
    baseURL: 'https://api.mercadolibre.com',
    timeout: 10000,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      Referer: 'https://www.mercadolivre.com.br/',
      Origin: 'https://www.mercadolivre.com.br',
    },
  });

  constructor(private prisma: PrismaService) {
    this.mlApi.interceptors.request.use((config) => {
      const token = process.env.ML_ACCESS_TOKEN;
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
  }

  async syncTopStrings() {
    if (this.syncInFlight) {
      this.logger.warn('Sincronização já em andamento. Reutilizando execução atual.');
      return this.syncInFlight;
    }

    this.syncInFlight = this.executeSyncTopStrings();
    try {
      return await this.syncInFlight;
    } finally {
      this.syncInFlight = null;
    }
  }

  private async executeSyncTopStrings() {
    await this.refreshAccessToken();
    try {
      const legacyMode = (process.env.ML_LEGACY_SYNC_MODE ?? 'true').toLowerCase() === 'true';
      this.logger.log('Iniciando sincronização...');
      this.logger.log(`Modo de sincronização: ${legacyMode ? 'LEGADO (categoria geral)' : 'ATUAL (categoria específica)'}`);
      const affiliateTag = process.env.ML_AFFILIATE_TAG || 'eduardolucas20230408114828';
      this.itemRatingsCache.clear();
      const summary: Array<{ type: StringType; label: string; total: number }> = [];
      let totalSaved = 0;
      const usedMlIds = new Set<string>();
      const categoryPriority: Record<StringType, number> = {
        [StringType.VIOLA_CAIPIRA]: 1,
        [StringType.CAVAQUINHO]: 2,
        [StringType.VIOLINO]: 3,
        [StringType.CONTRABAIXO]: 4,
        [StringType.GUITARRA]: 5,
        [StringType.VIOLAO]: 6,
      };
      const categoriesToProcess = [...this.stringCategories].sort(
        (a, b) => (categoryPriority[a.type] ?? 99) - (categoryPriority[b.type] ?? 99),
      );

      for (const category of categoriesToProcess) {
        try {
          const catalogMap = new Map<string, CatalogProduct>();

          const searchResults = await this.fetchProductsBySearch(
            affiliateTag,
            category.query,
            category.type,
            80,
            legacyMode ? this.LEGACY_CATEGORY_ID : category.categoryId,
          );

          for (const product of searchResults) {
            if (!catalogMap.has(product.mlId)) {
              catalogMap.set(product.mlId, product);
            }
          }

          const uniqueItems = Array.from(catalogMap.values())
            .filter((item) => !usedMlIds.has(item.mlId))
            .slice(0, 10);

          const backfillItems =
            uniqueItems.length < 10
              ? Array.from(catalogMap.values())
                  .filter((item) => !uniqueItems.some((selected) => selected.mlId === item.mlId))
                  .slice(0, 10 - uniqueItems.length)
              : [];

          const items = await this.applyRatingAndSort([...uniqueItems, ...backfillItems].slice(0, 10));

          if (items.length > uniqueItems.length) {
            this.logger.warn(
              `${category.label}: ${uniqueItems.length} itens únicos; preenchendo ${items.length - uniqueItems.length} posição(ões) com repetidos para manter top 10.`,
            );
          }

          if (items.length === 0) {
            this.logger.warn(`Nenhum item novo para ${category.label}. Mantendo dados atuais dessa categoria.`);
            summary.push({ type: category.type, label: category.label, total: 0 });
            continue;
          }

          await this.prisma.product.deleteMany({ where: { type: category.type } });

          let rank = 1;
          for (const item of items) {
            await this.prisma.product.create({
              data: {
                mlId: item.mlId,
                title: item.title,
                price: item.price,
                ratingAvg: item.ratingAvg,
                ratingCount: item.ratingCount,
                thumbnail: item.thumbnail,
                permalink: item.permalink,
                rank,
                type: category.type,
              },
            });
            usedMlIds.add(item.mlId);
            rank++;
            totalSaved++;
          }
          summary.push({ type: category.type, label: category.label, total: rank - 1 });
          this.logger.log(`${category.label}: ${rank - 1} itens.`);
        } catch (err) {
          this.logger.error(`Erro em ${category.label}: ${err.message}`);
          summary.push({ type: category.type, label: category.label, total: 0 });
        }
      }

      if (totalSaved === 0) {
        this.logger.warn('Nenhum produto encontrado na API neste ciclo.');
      }
      return { status: 'Sucesso', total: totalSaved, categories: summary };
    } catch (error: any) {
      if (error instanceof AxiosError && error.response?.status === 401) throw new BadGatewayException('Token inválido ou expirado.');
      this.logger.error(`Erro no sync geral: ${error?.message || JSON.stringify(error)}`);
      throw error;
    }
  }

  async getTopStrings(type?: string) {
    const resolvedType = this.resolveStringType(type);
    const rows = await this.prisma.product.findMany({
      where: { type: resolvedType },
      orderBy: [{ rank: 'asc' }, { id: 'asc' }],
      take: 120,
    });

    const uniqueByMlId = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!uniqueByMlId.has(row.mlId)) {
        uniqueByMlId.set(row.mlId, row);
      }
    }

    return Array.from(uniqueByMlId.values()).slice(0, 10);
  }

  @Cron(process.env.ML_SYNC_CRON ?? '*/10 * * * *')
  async handleCron() {
    this.logger.log('Sincronização automática');
    try {
      await this.syncTopStrings();
    } catch (error) {
      this.logger.error(`Falha: ${error?.message ?? error}`);
    }
  }

  async refreshAccessToken() {
    try {
      const response = await axios.post('https://api.mercadolibre.com/oauth/token', null, {
        params: {
          grant_type: 'refresh_token',
          client_id: process.env.ML_CLIENT_ID,
          client_secret: process.env.ML_CLIENT_SECRET,
          refresh_token: process.env.ML_REFRESH_TOKEN,
        },
      });
      const { access_token, refresh_token } = response.data;
      process.env.ML_ACCESS_TOKEN = access_token;
      process.env.ML_REFRESH_TOKEN = refresh_token;
      this.logger.log('Token renovado!');
    } catch (error) {
      this.logger.error('Falha ao renovar token');
    }
  }
}