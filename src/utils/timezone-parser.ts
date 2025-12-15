/**
 * Парсит часовой пояс из формата "X МСК"
 * МСК = UTC+3, поэтому:
 * - "0 МСК" = UTC+3
 * - "+2 МСК" = UTC+5
 * - "-1 МСК" = UTC+2
 * 
 * @param text - Текст в формате "X МСК" или просто число
 * @returns Смещение от UTC в часах или null, если не удалось распарсить
 */
export function parseTimezone(text: string): number | null {
  if (!text) {
    return null;
  }

  // Убираем лишние пробелы и приводим к нижнему регистру
  const normalized = text.trim().toLowerCase();

  // Проверяем формат "X МСК" или "X МСК" с плюсом/минусом
  const mskPattern = /([+-]?\d+)\s*мск/i;
  const mskMatch = normalized.match(mskPattern);

  if (mskMatch) {
    const offsetFromMsk = parseInt(mskMatch[1], 10);
    // МСК = UTC+3, поэтому добавляем 3
    const utcOffset = 3 + offsetFromMsk;
    // Проверяем валидность (обычно от UTC-12 до UTC+14)
    if (utcOffset >= -12 && utcOffset <= 14) {
      return utcOffset;
    }
  }

  // Если не нашли формат "X МСК", пробуем просто число (считаем, что это смещение от МСК)
  const numberPattern = /^([+-]?\d+)$/;
  const numberMatch = normalized.match(numberPattern);

  if (numberMatch) {
    const offsetFromMsk = parseInt(numberMatch[1], 10);
    const utcOffset = 3 + offsetFromMsk;
    if (utcOffset >= -12 && utcOffset <= 14) {
      return utcOffset;
    }
  }

  return null;
}
