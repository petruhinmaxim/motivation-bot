/**
 * Валидирует время в формате HH:MM
 * @param timeString - строка времени, например "14:00" или "09:30"
 * @returns объект с isValid и time (в формате HH:MM) или null
 */
export function validateTime(timeString: string): { isValid: boolean; time: string | null } {
  // Проверяем формат HH:MM
  const timeRegex = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
  
  if (!timeRegex.test(timeString.trim())) {
    return { isValid: false, time: null };
  }

  // Нормализуем формат (добавляем ведущий ноль если нужно)
  const parts = timeString.trim().split(':');
  const hours = parts[0].padStart(2, '0');
  const minutes = parts[1];
  const normalizedTime = `${hours}:${minutes}`;

  return { isValid: true, time: normalizedTime };
}
