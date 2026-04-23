import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, StringType } from '@prisma/client';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const dictionaryTerms = [
  {
    term: 'Phosphor Bronze',
    category: 'Liga',
    shortDesc: 'Liga equilibrada, com calor, brilho moderado e boa sustentação.',
    fullDesc: 'Liga muito usada em cordas de aço para violão. Costuma combinar brilho, corpo e boa resposta geral.',
  },
  {
    term: '80/20 Bronze',
    category: 'Liga',
    shortDesc: 'Liga mais brilhante e direta, com ataque evidente.',
    fullDesc: 'Composta por cobre e estanho, tende a entregar timbre aberto e mais brilho nas primeiras horas de uso.',
  },
  {
    term: 'Bronze 80/20',
    category: 'Liga',
    shortDesc: 'Versão clássica de cordas com som aberto e resposta viva.',
    fullDesc: 'Mesmo conceito de 80/20 Bronze, muito comum em linhas de encordoamento para violão de aço.',
  },
  {
    term: 'Nylon',
    category: 'Material',
    shortDesc: 'Material mais macio ao toque, com pegada confortável e suave.',
    fullDesc: 'Muito comum em violões clássicos. Entrega sensação mais leve e tensão menor que cordas de aço.',
  },
  {
    term: 'Aço',
    category: 'Material',
    shortDesc: 'Material com mais tensão, brilho e projeção sonora.',
    fullDesc: 'Indicado para violão aço, guitarra e baixo, com resposta mais firme e presença sonora maior.',
  },
  {
    term: 'Aco',
    category: 'Material',
    shortDesc: 'Material com mais tensão, brilho e projeção sonora.',
    fullDesc: 'Variação sem acento usada para facilitar buscas e leitura em interfaces e ferramentas de busca.',
  },
  {
    term: '0.10',
    category: 'Calibre',
    shortDesc: 'Conjunto leve, com toque mais macio e menor esforço para tocar.',
    fullDesc: 'Calibre leve, comum em quem prioriza conforto, bends mais fáceis e menor tensão na mão.',
  },
  {
    term: '0.11',
    category: 'Calibre',
    shortDesc: 'Equilíbrio entre conforto e presença sonora, com resposta mais firme.',
    fullDesc: 'Uma escolha intermediária que costuma agradar quem quer um pouco mais de corpo sem perder tocabilidade.',
  },
  {
    term: '0.12',
    category: 'Calibre',
    shortDesc: 'Mais corpo e resistência, indicado para quem quer projeção e estabilidade.',
    fullDesc: 'Calibre bem comum para violão de aço, oferecendo boa projeção e sensação mais robusta.',
  },
  {
    term: '0.13',
    category: 'Calibre',
    shortDesc: 'Tensão mais alta, com ataque forte e sensação mais robusta ao tocar.',
    fullDesc: 'Opção para quem prefere pegada firme, maior volume e não se incomoda com mais resistência.',
  },
];

const products = [
  {
    mlId: 'local-violao-001',
    title: 'Encordoamento Violão 0.10 Phosphor Bronze',
    price: 32.9,
    ratingAvg: 4.8,
    ratingCount: 126,
    thumbnail: '/branding/logo-full-cropped.png',
    permalink: 'https://example.com/violao-010-phosphor-bronze',
    rank: 1,
    type: StringType.VIOLAO,
  },
  {
    mlId: 'local-violao-002',
    title: 'Encordoamento Violão 0.11 Bronze 80/20',
    price: 29.9,
    ratingAvg: 4.7,
    ratingCount: 88,
    thumbnail: '/branding/logo-full-cropped.png',
    permalink: 'https://example.com/violao-011-bronze-8020',
    rank: 2,
    type: StringType.VIOLAO,
  },
  {
    mlId: 'local-violao-003',
    title: 'Encordoamento Violão Nylon Extra Light',
    price: 24.9,
    ratingAvg: 4.5,
    ratingCount: 54,
    thumbnail: '/branding/logo-full-cropped.png',
    permalink: 'https://example.com/violao-nylon-extra-light',
    rank: 3,
    type: StringType.VIOLAO,
  },
  {
    mlId: 'local-guitarra-001',
    title: 'Encordoamento Guitarra 0.10 Nickel Wound',
    price: 39.9,
    ratingAvg: 4.6,
    ratingCount: 73,
    thumbnail: '/branding/logo-mark.png',
    permalink: 'https://example.com/guitarra-010-nickel',
    rank: 1,
    type: StringType.GUITARRA,
  },
  {
    mlId: 'local-guitarra-002',
    title: 'Encordoamento Guitarra 0.09 Super Light',
    price: 34.9,
    ratingAvg: 4.4,
    ratingCount: 41,
    thumbnail: '/branding/logo-mark.png',
    permalink: 'https://example.com/guitarra-009-super-light',
    rank: 2,
    type: StringType.GUITARRA,
  },
  {
    mlId: 'local-guitarra-003',
    title: 'Encordoamento Guitarra Coated Light',
    price: 49.9,
    ratingAvg: 4.7,
    ratingCount: 96,
    thumbnail: '/branding/logo-mark.png',
    permalink: 'https://example.com/guitarra-coated-light',
    rank: 3,
    type: StringType.GUITARRA,
  },
  {
    mlId: 'local-baixo-001',
    title: 'Encordoamento Contrabaixo 045-105 Nickel',
    price: 109.9,
    ratingAvg: 4.8,
    ratingCount: 64,
    thumbnail: '/branding/logo-support.png',
    permalink: 'https://example.com/baixo-045-105-nickel',
    rank: 1,
    type: StringType.CONTRABAIXO,
  },
  {
    mlId: 'local-baixo-002',
    title: 'Encordoamento Contrabaixo 050-110 Stainless',
    price: 119.9,
    ratingAvg: 4.7,
    ratingCount: 52,
    thumbnail: '/branding/logo-support.png',
    permalink: 'https://example.com/baixo-050-110-stainless',
    rank: 2,
    type: StringType.CONTRABAIXO,
  },
  {
    mlId: 'local-cavaquinho-001',
    title: 'Encordoamento Cavaquinho 0.10 Aço',
    price: 26.9,
    ratingAvg: 4.6,
    ratingCount: 35,
    thumbnail: '/branding/favicon-mark.png',
    permalink: 'https://example.com/cavaquinho-010-aco',
    rank: 1,
    type: StringType.CAVAQUINHO,
  },
  {
    mlId: 'local-ukulele-001',
    title: 'Encordoamento Ukulele Nylon Concert',
    price: 31.9,
    ratingAvg: 4.7,
    ratingCount: 46,
    thumbnail: '/branding/favicon-mark.png',
    permalink: 'https://example.com/ukulele-nylon-concert',
    rank: 1,
    type: StringType.UKULELE,
  },
  {
    mlId: 'local-viola-001',
    title: 'Encordoamento Viola Caipira 0.12 Bronze',
    price: 44.9,
    ratingAvg: 4.7,
    ratingCount: 29,
    thumbnail: '/branding/favicon-mark.png',
    permalink: 'https://example.com/viola-caipira-012-bronze',
    rank: 1,
    type: StringType.VIOLA_CAIPIRA,
  },
  {
    mlId: 'local-violino-001',
    title: 'Encordoamento Violino Estudo 4/4',
    price: 58.9,
    ratingAvg: 4.5,
    ratingCount: 21,
    thumbnail: '/branding/favicon-mark.png',
    permalink: 'https://example.com/violino-estudo-44',
    rank: 1,
    type: StringType.VIOLINO,
  },
];

async function main() {
  await prisma.stringMaintenance.deleteMany();
  await prisma.dictionaryTerm.deleteMany();
  await prisma.product.deleteMany();

  await prisma.dictionaryTerm.createMany({
    data: dictionaryTerms,
  });

  await prisma.product.createMany({
    data: products,
  });

  console.log(`Seed concluida: ${dictionaryTerms.length} termos e ${products.length} produtos inseridos.`);
}

main()
  .catch((error) => {
    console.error('Falha ao executar seed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });