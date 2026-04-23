# Metodologia de vida util das cordas

Versao do modelo: `2026.04-audit-v1`

## Objetivo

Tornar o calculo de vida util auditavel e calibravel sem alterar codigo em cada ajuste.

## Equacao aplicada

`estimatedLifeDays = clamp(21, 150, round((baseDays - clampedHours * wearRate) * materialFactor))`

Onde:

- `clampedHours`: horas semanais limitadas entre 1 e 60.
- `baseDays`: vida util base do instrumento em dias.
- `wearRate`: desgaste diario equivalente por hora semanal de estudo.
- `materialFactor`: multiplicador por material/revestimento das cordas.

## Perfis padrao por instrumento (fallback interno)

- VIOLAO: `baseDays=90`, `wearRate=2.7`
- GUITARRA: `baseDays=75`, `wearRate=2.9`
- CONTRABAIXO: `baseDays=110`, `wearRate=2.2`
- CAVAQUINHO: `baseDays=80`, `wearRate=2.5`
- UKULELE: `baseDays=85`, `wearRate=2.3`
- VIOLA_CAIPIRA: `baseDays=95`, `wearRate=2.4`
- VIOLINO: `baseDays=70`, `wearRate=2.8`

## Fatores padrao por material (fallback interno)

- NYLON: `1.08`
- ACO_NIQUEL: `1.00`
- ACO_INOX: `1.12`
- BRONZE_8020: `0.95`
- PHOSPHOR_BRONZE: `1.00`
- REVESTIDA: `1.25`
- SINTETICA: `1.10`
- OUTRO: `1.00`

## Calibracao por configuracao

Sem migracao de banco, voce pode ajustar em runtime via variaveis de ambiente JSON:

- `STRING_LIFESPAN_PROFILES_JSON`
- `STRING_LIFESPAN_MATERIAL_FACTORS_JSON`

Exemplo:

```json
{
  "VIOLAO": { "baseDays": 88, "wearRate": 2.9 },
  "UKULELE": { "baseDays": 92, "wearRate": 2.1 }
}
```

```json
{
  "REVESTIDA": 1.32,
  "BRONZE_8020": 0.9
}
```

## Referencias tecnicas usadas para ancoragem

- D'Addario String Tension Pro: https://www.daddario.com/pages/string-tension-pro-string-tension-calculator/
- Ernie Ball String Explorer: https://www.ernieball.com/string-explorer
- Elixir Strings Tips (durabilidade/manutencao): https://www.elixirstrings.com/tips

Observacao: essas referencias sao usadas como ancoragem tecnica de mercado (tensao, calibre e manutencao). A calibracao final deve considerar o perfil de uso real da base de usuarios do CordasLivre.
