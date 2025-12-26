/**
 * Валидирует время в формате HH:MM или HH MM
 * @param timeString - строка времени, например "14:00", "14 00", "09:30" или "9 30"
 * @returns объект с isValid и time (в формате HH:MM) или null
 */
export function validateTime(timeString: string): { isValid: boolean; time: string | null } {
  const trimmed = timeString.trim();
  
  // Проверяем оба формата: HH:MM и HH MM
  const timeRegexWithColon = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
  const timeRegexWithSpace = /^([0-1]?[0-9]|2[0-3])\s+([0-5][0-9])$/;
  
  let parts: string[] | null = null;
  
  if (timeRegexWithColon.test(trimmed)) {
    parts = trimmed.split(':');
  } else if (timeRegexWithSpace.test(trimmed)) {
    parts = trimmed.split(/\s+/);
  } else {
    return { isValid: false, time: null };
  }

  if (!parts || parts.length !== 2) {
    return { isValid: false, time: null };
  }

  // Нормализуем формат (добавляем ведущий ноль если нужно)
  const hours = parts[0].padStart(2, '0');
  const minutes = parts[1];
  const normalizedTime = `${hours}:${minutes}`;

  return { isValid: true, time: normalizedTime };
}
