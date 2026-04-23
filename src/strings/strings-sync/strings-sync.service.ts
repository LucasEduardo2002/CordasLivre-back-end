import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { PrismaService } from '../../prisma/prisma.service';
import { Cron } from '@nestjs/schedule';
import { StringType } from '@prisma/client';

type MaintenanceAlertLevel = 'OK' | 'SOON' | 'DUE' | 'OVERDUE';
type MaintenanceAlertTone = 'success' | 'warning' | 'danger';

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

type TechnicalProfile = {
  material: string;
  coating: string;
  gauge: string;
  tension: string;
  purpose: string;
};

type MarketQualitySignal = {
  qualityIndex: number;
  qualityBand: 'muito alta' | 'alta' | 'boa' | 'regular';
  confidence: 'baixa' | 'media' | 'alta';
  ratingText: string;
  sampleText: string;
};

type ToneAssistantInput = {
  instrument?: string;
  level?: string;
  style?: string;
};

type ToneAssistantRecommendation = {
  type: StringType;
  instrumentLabel: string;
  levelLabel: string;
  styleLabel: string;
  compatibilityScore: number;
  compatibilityLabel: 'Excelente' | 'Boa' | 'Ajustável';
  compatibilityTone: 'success' | 'warning';
  recommendedGauge: string;
  recommendedMaterial: string;
  recommendedTension: string;
  confidence: 'alta' | 'media';
  decisionFactors: string[];
  referenceSources: Array<{
    name: string;
    url: string;
    note: string;
  }>;
  explanation: string;
  nextStep: string;
  products: Array<{
    id: number;
    title: string;
    price: number;
    ratingAvg: number | null;
    ratingCount: number;
    permalink: string;
    thumbnail: string;
    rank: number;
  }>;
};

type MaintenanceInput = {
  userId?: string;
  email?: string;
  instrument?: string;
  lastChangeDate?: string;
  studyHoursPerWeek?: number;
};

type MaintenanceAlertView = {
  code: MaintenanceAlertLevel;
  label: string;
  tone: MaintenanceAlertTone;
  message: string;
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
    { type: StringType.UKULELE, label: 'Ukulele', query: 'encordoamento ukulele' },
    { type: StringType.VIOLA_CAIPIRA, label: 'Viola Caipira', query: 'encordoamento viola caipira' },
    { type: StringType.VIOLINO, label: 'Violino', query: 'encordoamento violino' },
  ];

  private getTypeLabel(type: StringType): string {
    const labels: Record<StringType, string> = {
      [StringType.VIOLAO]: 'violão',
      [StringType.GUITARRA]: 'guitarra',
      [StringType.CONTRABAIXO]: 'contrabaixo',
      [StringType.CAVAQUINHO]: 'cavaquinho',
      [StringType.UKULELE]: 'ukulele',
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

  private inferTechnicalProfile(payload: AiReviewPayload): TechnicalProfile {
    const normalizedTitle = this.normalizeText(payload.title);
    const contains = (...tokens: string[]) => tokens.some((token) => normalizedTitle.includes(token));

    const material =
      contains('nylon', 'nailon')
        ? 'Nylon (toque mais macio e timbre quente)'
        : contains('fosforo bronze', 'phosphor bronze')
          ? 'Fósforo Bronze (equilíbrio entre brilho e corpo)'
          : contains('80/20', 'bronze')
            ? 'Bronze 80/20 (ataque brilhante e projeção)'
            : contains('aco inox', 'inox')
              ? 'Aço inox (durabilidade maior e brilho acentuado)'
              : contains('niquel', 'nickel')
                ? 'Níquel/niquelado (resposta equilibrada, comum em guitarra/baixo)'
                : 'Material não identificado claramente no título';

    const coating =
      contains('coated', 'nanoweb', 'polyweb', 'elixir')
        ? 'Com revestimento (tende a durar mais, com toque mais suave)'
        : 'Sem indicação clara de revestimento';

    const gaugeMatch = normalizedTitle.match(/\b(0?\d{2})\s*[-x]\s*(0?\d{2})\b/);
    const gaugeSingleMatch = normalizedTitle.match(/\b(009|010|011|012|013|045|050|085|100|105)\b/);
    const gauge = gaugeMatch
      ? `Calibre provável ${gaugeMatch[1]}-${gaugeMatch[2]}`
      : gaugeSingleMatch
        ? `Calibre provável ${gaugeSingleMatch[1]}`
        : 'Calibre não identificado no título';

    const tension =
      contains('extra light', 'super light')
        ? 'Tensão leve (tocabilidade facilitada)'
        : contains('light')
          ? 'Tensão leve/média leve'
          : contains('medium', 'medio')
            ? 'Tensão média (equilíbrio entre conforto e volume)'
            : contains('heavy')
              ? 'Tensão alta (mais projeção, exige mais pegada)'
              : 'Tensão não especificada no título';

    const purposeByType: Record<StringType, string> = {
      [StringType.VIOLAO]: contains('nylon', 'nailon')
        ? 'Finalidade sugerida: estudo, MPB e violão clássico'
        : 'Finalidade sugerida: violão aço para batida, dedilhado e uso geral',
      [StringType.GUITARRA]: 'Finalidade sugerida: uso geral em guitarra (base, solo e prática)',
      [StringType.CONTRABAIXO]: 'Finalidade sugerida: contrabaixo para prática, ensaio e palco',
      [StringType.CAVAQUINHO]: 'Finalidade sugerida: cavaquinho para base e condução rítmica',
      [StringType.UKULELE]: 'Finalidade sugerida: ukulele para estudo, base rítmica e repertório acústico',
      [StringType.VIOLA_CAIPIRA]: 'Finalidade sugerida: viola caipira para repertório sertanejo e regional',
      [StringType.VIOLINO]: 'Finalidade sugerida: violino para estudo e performance conforme setup',
    };

    return {
      material,
      coating,
      gauge,
      tension,
      purpose: purposeByType[payload.type],
    };
  }

  private buildMarketQualitySignal(payload: AiReviewPayload): MarketQualitySignal {
    const hasRating = payload.ratingAvg !== null;
    const baseRating = payload.ratingAvg ?? 4;
    const normalizedRating = Math.max(0, Math.min(1, baseRating / 5));
    const volumeFactor = Math.min(1, Math.log10(payload.ratingCount + 1) / Math.log10(200));
    const qualityIndex = Math.round(normalizedRating * 75 + volumeFactor * 25);

    const qualityBand: MarketQualitySignal['qualityBand'] =
      qualityIndex >= 88 ? 'muito alta' : qualityIndex >= 78 ? 'alta' : qualityIndex >= 68 ? 'boa' : 'regular';

    const confidence: MarketQualitySignal['confidence'] =
      payload.ratingCount >= 120 ? 'alta' : payload.ratingCount >= 30 ? 'media' : 'baixa';

    return {
      qualityIndex,
      qualityBand,
      confidence,
      ratingText: hasRating
        ? `${payload.ratingAvg?.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}/5`
        : 'sem nota consolidada',
      sampleText: `${payload.ratingCount.toLocaleString('pt-BR')} ${payload.ratingCount === 1 ? 'avaliação' : 'avaliações'}`,
    };
  }

  private buildLocalAiReview(payload: AiReviewPayload): AiReviewResult {
    const instrumentLabel = this.getTypeLabel(payload.type);
    const profile = this.inferTechnicalProfile(payload);
    const signal = this.buildMarketQualitySignal(payload);
    const hasRating = payload.ratingAvg !== null;
    const valueBand = payload.price <= 70 ? 'entrada' : payload.price <= 180 ? 'intermediário' : 'premium';

    const pros = [
      hasRating
        ? `Aceitação de mercado ${signal.qualityBand} (nota ${signal.ratingText}, amostra ${signal.sampleText}, índice técnico ${signal.qualityIndex}/100).`
        : `Sem nota consolidada; análise técnica baseada em finalidade, especificação percebida e faixa de preço (${valueBand}).`,
      `${profile.material}. ${profile.coating}.`,
      `${profile.gauge}. ${profile.tension}. ${profile.purpose}.`,
    ];

    const attentionPoints = [
      'Confirme no anúncio o calibre exato e a tensão para evitar desconforto na tocabilidade e ajuste indevido do instrumento.',
      'Valide material e revestimento com as fotos/descrição do vendedor para garantir o timbre e a durabilidade esperados.',
    ];

    if (payload.ratingCount < 10) {
      attentionPoints.push('Amostra de avaliações pequena; trate o índice de qualidade como preliminar e compare com opções de maior volume.');
    }

    const summary = hasRating
      ? `Análise técnica para ${instrumentLabel}: nota ${signal.ratingText} com ${signal.sampleText}, índice ${signal.qualityIndex}/100 e classificação ${signal.qualityBand}. O conjunto de especificações percebidas no título indica foco em ${profile.purpose.toLowerCase().replace('finalidade sugerida: ', '')}.`
      : `Análise técnica para ${instrumentLabel}: sem nota consolidada, então o parecer prioriza qualidade percebida no título (material, calibre/tensão e finalidade) e posicionamento de preço ${valueBand}.`;

    const safeRating = payload.ratingAvg ?? 0;

    const verdict = hasRating
      ? safeRating >= 4.7
        ? `Indicação técnica forte para compra, desde que o anúncio confirme ${profile.gauge.toLowerCase()} e ${profile.tension.toLowerCase()} adequados ao seu setup.`
        : safeRating >= 4.3
          ? `Boa alternativa técnica para ${instrumentLabel}, com necessidade de validação final de material e tensão conforme sua finalidade de uso.`
          : `Opção tecnicamente viável, porém com aceitação de mercado abaixo do ideal; compare com produtos de índice técnico superior antes da decisão.`
      : `Sem nota consolidada: recomendado comparar com 2-3 encordoamentos com mais avaliações e especificação técnica mais explícita.`;

    return {
      title: payload.title,
      summary,
      pros,
      attentionPoints,
      verdict,
      confidence: signal.confidence,
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
      const profile = this.inferTechnicalProfile(payload);
      const signal = this.buildMarketQualitySignal(payload);
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
                'Você é um especialista técnico em encordoamentos. Gere uma avaliação técnica e detalhada em português do Brasil, considerando: avaliações de usuários (nota e volume), qualidade percebida do encordoamento (material, revestimento, calibre, tensão) e finalidade de uso. Responda somente JSON válido com: summary (string detalhada), pros (array de 3 strings), attentionPoints (array de 3 strings), verdict (string técnica de recomendação), confidence (baixa|media|alta). Não invente dados; quando faltar dado, deixe explícito.',
            },
            {
              role: 'user',
              content: `Produto: ${payload.title}\nInstrumento: ${instrumentLabel}\nPreço: R$ ${payload.price.toFixed(
                2,
              )}\nNota média: ${payload.ratingAvg ?? 'sem nota'}\nQuantidade de avaliações: ${payload.ratingCount}\nÍndice técnico calculado internamente: ${signal.qualityIndex}/100 (${signal.qualityBand})\nMaterial inferido: ${profile.material}\nRevestimento inferido: ${profile.coating}\nCalibre inferido: ${profile.gauge}\nTensão inferida: ${profile.tension}\nFinalidade sugerida: ${profile.purpose}`,
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`OpenAI indisponível para avaliação IA: ${errorMessage}`);
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

  private resolveInstrumentFromWizard(instrument?: string): { type: StringType; label: string } {
    const normalized = this.normalizeText(instrument ?? 'violao classico');

    if (normalized.includes('guitarra')) return { type: StringType.GUITARRA, label: 'Guitarra' };
    if (normalized.includes('contrabaixo') || normalized.includes('baixo')) return { type: StringType.CONTRABAIXO, label: 'Contrabaixo' };
    if (normalized.includes('cavaquinho')) return { type: StringType.CAVAQUINHO, label: 'Cavaquinho' };
    if (normalized.includes('ukulele') || normalized.includes('ukelele')) return { type: StringType.UKULELE, label: 'Ukulele' };
    if (normalized.includes('viola caipira')) return { type: StringType.VIOLA_CAIPIRA, label: 'Viola Caipira' };
    if (normalized.includes('violino')) return { type: StringType.VIOLINO, label: 'Violino' };
    return { type: StringType.VIOLAO, label: 'Violão Clássico' };
  }

  private resolveLevel(level?: string): 'iniciante' | 'intermediario' | 'avancado' {
    const normalized = this.normalizeText(level ?? 'iniciante');
    if (normalized.includes('avanc')) return 'avancado';
    if (normalized.includes('intermedi')) return 'intermediario';
    return 'iniciante';
  }

  private resolveStyle(style?: string): 'rock' | 'mpb' | 'sertanejo' | 'jazz' | 'pop' {
    const normalized = this.normalizeText(style ?? 'mpb');
    if (normalized.includes('rock')) return 'rock';
    if (normalized.includes('jazz')) return 'jazz';
    if (normalized.includes('pop')) return 'pop';
    if (normalized.includes('sertanej')) return 'sertanejo';
    return 'mpb';
  }

  async recommendToneAssistant(input: ToneAssistantInput): Promise<ToneAssistantRecommendation> {
    const instrument = this.resolveInstrumentFromWizard(input.instrument);
    const level = this.resolveLevel(input.level);
    const style = this.resolveStyle(input.style);

    const gaugeProfileByType: Record<StringType, Record<'iniciante' | 'intermediario' | 'avancado', string>> = {
      [StringType.VIOLAO]: {
        iniciante: '0.10-0.47 (aço) ou tensão baixa/média-baixa (nylon)',
        intermediario: '0.11-0.52 (aço) ou tensão média (nylon)',
        avancado: '0.12-0.53 (aço) ou tensão média/alta (nylon)',
      },
      [StringType.GUITARRA]: {
        iniciante: '0.09-0.42 ou 0.10-0.46',
        intermediario: '0.10-0.46 ou 0.10-0.52',
        avancado: '0.10-0.52 ou 0.11-0.49',
      },
      [StringType.CONTRABAIXO]: {
        iniciante: '0.40-0.100',
        intermediario: '0.45-0.105',
        avancado: '0.45-0.110',
      },
      [StringType.CAVAQUINHO]: {
        iniciante: 'calibre leve padrão para estudo',
        intermediario: 'calibre médio para equilíbrio entre brilho e conforto',
        avancado: 'calibre médio/alto para projeção mais forte',
      },
      [StringType.UKULELE]: {
        iniciante: 'nylon leve padrão (soprano/concert) para conforto',
        intermediario: 'nylon fluorocarbono de tensão média',
        avancado: 'fluorocarbono ou jogos de tensão média/alta para projeção',
      },
      [StringType.VIOLA_CAIPIRA]: {
        iniciante: 'jogo leve para menor esforço na mão esquerda',
        intermediario: 'jogo médio para melhor projeção',
        avancado: 'jogo médio/alto para afinação firme e ataque forte',
      },
      [StringType.VIOLINO]: {
        iniciante: 'jogo de estudo com tensão baixa/média',
        intermediario: 'jogo de tensão média',
        avancado: 'jogo de tensão média/alta conforme resposta do instrumento',
      },
    };

    const recommendedGauge = gaugeProfileByType[instrument.type]?.[level] ?? gaugeProfileByType[StringType.VIOLAO].iniciante;

    const materialByTypeAndStyle: Record<StringType, Record<'rock' | 'mpb' | 'sertanejo' | 'jazz' | 'pop', string>> = {
      [StringType.VIOLAO]: {
        mpb: 'Nylon (violão clássico) ou fósforo bronze (violão aço)',
        sertanejo: 'Aço bronze 80/20 ou fósforo bronze para ataque mais presente',
        rock: 'Aço fósforo bronze para mais brilho e projeção',
        jazz: 'Nylon de tensão média para timbre mais encorpado',
        pop: 'Fósforo bronze para equilíbrio entre brilho e corpo',
      },
      [StringType.GUITARRA]: {
        rock: 'Aço niquelado (nickel wound)',
        mpb: 'Aço niquelado com tensão média para dinâmica suave',
        sertanejo: 'Aço niquelado para brilho com bom sustain',
        jazz: 'Níquel puro ou aço niquelado para timbre mais quente',
        pop: 'Aço niquelado para versatilidade em base e fraseado',
      },
      [StringType.CONTRABAIXO]: {
        rock: 'Níquel para ataque definido; aço inox para mais brilho',
        mpb: 'Níquel para grave encorpado e toque confortável',
        sertanejo: 'Níquel com tensão média para consistência no palco',
        jazz: 'Flatwound (som aveludado) ou níquel roundwound',
        pop: 'Níquel roundwound para equilíbrio entre punch e conforto',
      },
      [StringType.CAVAQUINHO]: {
        rock: 'Aço de tensão média para projeção',
        mpb: 'Aço leve/médio para equilíbrio entre brilho e conforto',
        sertanejo: 'Aço com ataque mais marcado',
        jazz: 'Aço de tensão média para articulação limpa',
        pop: 'Aço leve para fraseado confortável',
      },
      [StringType.UKULELE]: {
        rock: 'Fluorocarbono de tensão média para ataque mais definido',
        mpb: 'Nylon ou fluorocarbono leve/médio para equilíbrio e conforto',
        sertanejo: 'Fluorocarbono médio para projeção com brilho',
        jazz: 'Fluorocarbono para articulação mais limpa',
        pop: 'Nylon leve ou fluorocarbono para resposta rápida',
      },
      [StringType.VIOLA_CAIPIRA]: {
        rock: 'Aço para resposta firme',
        mpb: 'Aço de tensão média para timbre equilibrado',
        sertanejo: 'Aço com boa projeção e afinação estável',
        jazz: 'Aço tensão média para controle dinâmico',
        pop: 'Aço médio para versatilidade',
      },
      [StringType.VIOLINO]: {
        rock: 'Núcleo sintético com tensão média para estabilidade',
        mpb: 'Núcleo sintético para timbre equilibrado',
        sertanejo: 'Núcleo sintético com boa projeção',
        jazz: 'Núcleo sintético ou aço conforme articulação desejada',
        pop: 'Núcleo sintético de resposta rápida',
      },
    };

    const recommendedMaterial = materialByTypeAndStyle[instrument.type]?.[style] ?? materialByTypeAndStyle[StringType.VIOLAO].mpb;

    const tensionByLevel: Record<'iniciante' | 'intermediario' | 'avancado', string> = {
      iniciante: 'Baixa a média-baixa',
      intermediario: 'Média',
      avancado: 'Média a média-alta',
    };
    const recommendedTension = tensionByLevel[level];

    const styleLabel =
      style === 'rock' ? 'Rock' : style === 'sertanejo' ? 'Sertanejo' : style === 'jazz' ? 'Jazz' : style === 'pop' ? 'Pop' : 'MPB';
    const levelLabel = level === 'iniciante' ? 'Iniciante' : level === 'intermediario' ? 'Intermediário' : 'Avançado';

    const rows = await this.prisma.product.findMany({
      where: { type: instrument.type },
      orderBy: [{ rank: 'asc' }, { id: 'asc' }],
      take: 20,
    });

    const normalizedMaterial = this.normalizeText(recommendedMaterial);
    const materialTokens = normalizedMaterial.split(' ').filter((token) => token.length >= 3);
    const filtered = rows.filter((row) => {
      const title = this.normalizeText(row.title);
      return materialTokens.some((token) => title.includes(token));
    });

    const selectedProducts = (filtered.length > 0 ? filtered : rows).slice(0, 5).map((item) => ({
      id: item.id,
      title: item.title,
      price: item.price,
      ratingAvg: item.ratingAvg,
      ratingCount: item.ratingCount,
      permalink: item.permalink,
      thumbnail: item.thumbnail,
      rank: item.rank,
    }));

    const commonStylesByType: Record<StringType, Array<'rock' | 'mpb' | 'sertanejo' | 'jazz' | 'pop'>> = {
      [StringType.VIOLAO]: ['mpb', 'sertanejo', 'pop'],
      [StringType.GUITARRA]: ['rock', 'jazz', 'pop'],
      [StringType.CONTRABAIXO]: ['rock', 'jazz', 'pop', 'mpb'],
      [StringType.CAVAQUINHO]: ['mpb', 'sertanejo'],
      [StringType.UKULELE]: ['mpb', 'pop', 'jazz'],
      [StringType.VIOLA_CAIPIRA]: ['sertanejo', 'mpb'],
      [StringType.VIOLINO]: ['jazz', 'pop', 'mpb'],
    };
    const isCommonStyle = (commonStylesByType[instrument.type] ?? []).includes(style);

    const confidence: 'alta' | 'media' =
      (instrument.type === StringType.GUITARRA || instrument.type === StringType.CONTRABAIXO || instrument.type === StringType.VIOLAO || instrument.type === StringType.UKULELE) && level !== 'avancado'
        ? 'alta'
        : 'media';

    let compatibilityScore = 70;
    compatibilityScore += confidence === 'alta' ? 12 : 7;
    compatibilityScore += level === 'iniciante' ? 6 : level === 'intermediario' ? 4 : 2;
    compatibilityScore += isCommonStyle ? 5 : 2;
    compatibilityScore += filtered.length > 0 ? 4 : 1;
    compatibilityScore = Math.max(65, Math.min(96, compatibilityScore));

    const compatibilityLabel: ToneAssistantRecommendation['compatibilityLabel'] =
      compatibilityScore >= 88 ? 'Excelente' : compatibilityScore >= 78 ? 'Boa' : 'Ajustável';
    const compatibilityTone: ToneAssistantRecommendation['compatibilityTone'] = compatibilityScore >= 78 ? 'success' : 'warning';

    const decisionFactors = [
      `Instrumento selecionado: ${instrument.label}.`,
      `Nível informado: ${levelLabel}, com foco de tensão ${recommendedTension.toLowerCase()}.`,
      `Estilo principal: ${styleLabel}, priorizando material ${recommendedMaterial.toLowerCase()}.`,
      'Referência técnica de tensão: variações de calibre, escala e afinação alteram tocabilidade e resposta sonora.',
    ];

    const referenceSources: ToneAssistantRecommendation['referenceSources'] = [
      {
        name: "D'Addario String Tension Pro 2.0",
        url: 'https://www.daddario.com/pages/string-tension-pro-string-tension-calculator/',
        note: 'Base técnica para relação entre calibre, afinação, escala e tensão percebida.',
      },
      {
        name: 'Ernie Ball String Explorer / Slinky Nickel Wound',
        url: 'https://www.ernieball.com/string-explorer',
        note: 'Faixas de calibres comerciais amplamente utilizadas em guitarra e contrabaixo.',
      },
    ];

    const explanation =
      level === 'iniciante'
        ? `Para ${instrument.label}, no nível iniciante, recomendamos ${recommendedGauge} com tensão ${recommendedTension.toLowerCase()} para facilitar a tocabilidade e reduzir fadiga nos dedos. No estilo ${styleLabel}, ${recommendedMaterial.toLowerCase()} tende a entregar melhor equilíbrio entre timbre e conforto.`
        : level === 'intermediario'
          ? `Para ${instrument.label}, no nível intermediário, o conjunto ${recommendedGauge} com tensão ${recommendedTension.toLowerCase()} costuma oferecer mais definição sem sacrificar conforto. Para ${styleLabel}, ${recommendedMaterial.toLowerCase()} mantém versatilidade e boa resposta.`
          : `Para ${instrument.label}, no nível avançado, recomendamos ${recommendedGauge} com tensão ${recommendedTension.toLowerCase()} para maior controle dinâmico e estabilidade. No estilo ${styleLabel}, ${recommendedMaterial.toLowerCase()} favorece projeção e precisão tímbrica.`;

    return {
      type: instrument.type,
      instrumentLabel: instrument.label,
      levelLabel,
      styleLabel,
      compatibilityScore,
      compatibilityLabel,
      compatibilityTone,
      recommendedGauge,
      recommendedMaterial,
      recommendedTension,
      confidence,
      decisionFactors,
      referenceSources,
      explanation,
      nextStep:
        'Use os produtos sugeridos como ponto de partida e valide conforto, afinação e resposta dinâmica por 7 dias antes de fixar o calibre definitivo.',
      products: selectedProducts,
    };
  }

  private calculateEstimatedLifeDays(type: StringType, studyHoursPerWeek: number): number {
    const clampedHours = Math.max(1, Math.min(60, Math.floor(studyHoursPerWeek)));

    const lifeProfile: Record<StringType, { baseDays: number; wearRate: number }> = {
      [StringType.VIOLAO]: { baseDays: 90, wearRate: 2.7 },
      [StringType.GUITARRA]: { baseDays: 75, wearRate: 2.9 },
      [StringType.CONTRABAIXO]: { baseDays: 110, wearRate: 2.2 },
      [StringType.CAVAQUINHO]: { baseDays: 80, wearRate: 2.5 },
      [StringType.UKULELE]: { baseDays: 85, wearRate: 2.3 },
      [StringType.VIOLA_CAIPIRA]: { baseDays: 95, wearRate: 2.4 },
      [StringType.VIOLINO]: { baseDays: 70, wearRate: 2.8 },
    };

    const profile = lifeProfile[type] ?? lifeProfile[StringType.VIOLAO];
    const estimated = Math.round(profile.baseDays - clampedHours * profile.wearRate);

    return Math.max(21, Math.min(150, estimated));
  }

  private getStringMaintenanceStore() {
    return (this.prisma as unknown as {
      stringMaintenance: {
        upsert: (...args: any[]) => Promise<any>;
        findMany: (...args: any[]) => Promise<any[]>;
        update: (...args: any[]) => Promise<any>;
      };
    }).stringMaintenance;
  }

  private buildMaintenanceAlert(nextAlertDate: Date): MaintenanceAlertView {
    const now = new Date();
    const msPerDay = 1000 * 60 * 60 * 24;
    const daysUntil = Math.ceil((nextAlertDate.getTime() - now.getTime()) / msPerDay);

    if (daysUntil <= 0) {
      return {
        code: 'OVERDUE',
        label: 'Troca imediata',
        tone: 'danger',
        message: 'Suas cordas já estão perdendo o brilho. Que tal garantir um set novo?',
      };
    }

    if (daysUntil <= 7) {
      return {
        code: 'DUE',
        label: 'Troca urgente',
        tone: 'danger',
        message: `Suas cordas estão perto do fim da vida útil (aprox. ${daysUntil} dia(s)). Planeje a troca para manter afinação e conforto.`,
      };
    }

    if (daysUntil <= 21) {
      return {
        code: 'SOON',
        label: 'Atenção',
        tone: 'warning',
        message: `Seu set entra em janela de troca em breve (${daysUntil} dias).`,
      };
    }

    return {
      code: 'OK',
      label: 'Ok por enquanto',
      tone: 'success',
      message: `Cordas em bom estado. Próxima janela estimada em ${daysUntil} dias.`,
    };
  }

  async registerStringMaintenance(input: MaintenanceInput) {
    const stringMaintenanceStore = this.getStringMaintenanceStore();
    const email = String(input.email ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      throw new BadRequestException('Informe um e-mail válido para registrar o alerta.');
    }

    const type = this.resolveStringType(input.instrument);
    const lastChangeDate = new Date(String(input.lastChangeDate ?? ''));
    if (Number.isNaN(lastChangeDate.getTime())) {
      throw new BadRequestException('Informe uma data de troca válida.');
    }

    const parsedHours = Number(input.studyHoursPerWeek ?? 0);
    if (!Number.isFinite(parsedHours) || parsedHours <= 0) {
      throw new BadRequestException('Informe horas de estudo por semana maiores que zero.');
    }

    const estimatedLifeDays = this.calculateEstimatedLifeDays(type, parsedHours);
    const nextAlertDate = new Date(lastChangeDate.getTime() + estimatedLifeDays * 24 * 60 * 60 * 1000);
    const alert = this.buildMaintenanceAlert(nextAlertDate);

    const topProduct = await this.prisma.product.findFirst({
      where: { type },
      orderBy: { rank: 'asc' },
    });

    const maintenance = await stringMaintenanceStore.upsert({
      where: {
        userEmail_type: {
          userEmail: email,
          type,
        },
      },
      create: {
        userId: input.userId,
        userEmail: email,
        type,
        lastChangeDate,
        studyHoursPerWeek: Math.floor(parsedHours),
        estimatedLifeDays,
        nextAlertDate,
        alertLevel: alert.code,
        alertMessage: alert.message,
        affiliateUrl: topProduct?.permalink,
      },
      update: {
        userId: input.userId,
        lastChangeDate,
        studyHoursPerWeek: Math.floor(parsedHours),
        estimatedLifeDays,
        nextAlertDate,
        alertLevel: alert.code,
        alertMessage: alert.message,
        affiliateUrl: topProduct?.permalink,
      },
    });

    return {
      profile: maintenance,
      alert,
    };
  }

  async getMaintenanceAlerts(email?: string, type?: string) {
    const stringMaintenanceStore = this.getStringMaintenanceStore();
    const normalizedEmail = String(email ?? '').trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      throw new BadRequestException('Informe o e-mail para consultar os alertas.');
    }

    const whereType = type ? this.resolveStringType(type) : undefined;
    const rows = await stringMaintenanceStore.findMany({
      where: {
        userEmail: normalizedEmail,
        ...(whereType ? { type: whereType } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });

    return rows.map((row) => ({
      ...row,
      computedAlert: this.buildMaintenanceAlert(row.nextAlertDate),
    }));
  }

  async refreshMaintenanceAlerts() {
    const stringMaintenanceStore = this.getStringMaintenanceStore();
    const rows = await stringMaintenanceStore.findMany();

    for (const row of rows) {
      const computed = this.buildMaintenanceAlert(row.nextAlertDate);
      if (computed.code !== row.alertLevel || computed.message !== (row.alertMessage ?? '')) {
        await stringMaintenanceStore.update({
          where: { id: row.id },
          data: {
            alertLevel: computed.code,
            alertMessage: computed.message,
            lastNotifiedAt: computed.code === 'OK' ? row.lastNotifiedAt : new Date(),
          },
        });
      }
    }
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
      [StringType.UKULELE]: ['ukulele', 'ukelele'],
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
      [StringType.UKULELE]: ['ukulele', 'ukelele'],
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
      [StringType.UKULELE]: [
        'encordoamento ukulele',
        'corda ukulele',
        'jogo cordas ukulele',
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
        this.logger.warn(`Strict mode: products/search falhou para "${query}": ${(error as Error)?.message || error}`);
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
          this.logger.debug(`Strict mode: falha ao montar item ${productId}: ${(error as Error)?.message || error}`);
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
        this.logger.debug(`Falha no fallback highlights para ${entry?.id}: ${(productError as Error)?.message || productError}`);
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
        this.logger.debug(`Falha em products/search fallback para ${productId}: ${(error as Error)?.message || error}`);
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
            const errorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
            this.logger.warn(`Fallback sem token falhou para "${searchQuery}": ${errorMessage}`);
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
          const errorMessage = sellerFallbackError instanceof Error ? sellerFallbackError.message : String(sellerFallbackError);
          this.logger.warn(
            `Fallback via seller items falhou para "${searchQuery}": ${errorMessage}`,
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
          const errorMessage = productsSearchError instanceof Error ? productsSearchError.message : String(productsSearchError);
          this.logger.warn(
            `Fallback via products/search falhou para "${searchQuery}": ${errorMessage}`,
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
          const errorMessage = highlightsFallbackError instanceof Error ? highlightsFallbackError.message : String(highlightsFallbackError);
          this.logger.warn(
            `Fallback via highlights falhou para "${searchQuery}": ${errorMessage}`,
          );
        }
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Falha ao buscar "${searchQuery}": ${errorMessage}`);
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
        [StringType.UKULELE]: 3,
        [StringType.VIOLINO]: 4,
        [StringType.CONTRABAIXO]: 5,
        [StringType.GUITARRA]: 6,
        [StringType.VIOLAO]: 7,
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
          const errorMessage = err instanceof Error ? err.message : String(err);
          this.logger.error(`Erro em ${category.label}: ${errorMessage}`);
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
      await this.refreshMaintenanceAlerts();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Falha: ${errorMessage}`);
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

  async checkDatabaseHealth() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ok',
        database: 'active',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { status: 'error', message: errorMessage };
    }
  }
}