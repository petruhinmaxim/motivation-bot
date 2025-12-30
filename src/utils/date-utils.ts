/**
 * Получает текущую дату в формате YYYY-MM-DD с учетом часового пояса пользователя
 * @param timezoneOffset - Смещение часового пояса от UTC в часах (например, 3 для МСК)
 * @returns Дата в формате YYYY-MM-DD
 */
export function getCurrentDateString(timezoneOffset: number | null = null): string {
  const now = new Date();
  
  // Если указан часовой пояс, применяем смещение
  if (timezoneOffset !== null) {
    // Получаем UTC время
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
    // Применяем смещение часового пояса
    const localTime = new Date(utcTime + (timezoneOffset * 3600000));
    
    const year = localTime.getFullYear();
    const month = String(localTime.getMonth() + 1).padStart(2, '0');
    const day = String(localTime.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
  }
  
  // Если часовой пояс не указан, используем UTC
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

/**
 * Получает вчерашнюю дату в формате YYYY-MM-DD с учетом часового пояса пользователя
 * @param timezoneOffset - Смещение часового пояса от UTC в часах (например, 3 для МСК)
 * @returns Дата в формате YYYY-MM-DD
 */
export function getYesterdayDateString(timezoneOffset: number | null = null): string {
  const now = new Date();
  
  // Если указан часовой пояс, применяем смещение
  if (timezoneOffset !== null) {
    // Получаем UTC время
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
    // Применяем смещение часового пояса
    const localTime = new Date(utcTime + (timezoneOffset * 3600000));
    
    // Вычитаем один день
    const yesterday = new Date(localTime);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const year = yesterday.getFullYear();
    const month = String(yesterday.getMonth() + 1).padStart(2, '0');
    const day = String(yesterday.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
  }
  
  // Если часовой пояс не указан, используем UTC
  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  
  const year = yesterday.getUTCFullYear();
  const month = String(yesterday.getUTCMonth() + 1).padStart(2, '0');
  const day = String(yesterday.getUTCDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

/**
 * Форматирует дату в строку формата YYYY-MM-DD с учетом часового пояса
 * @param date - Дата для форматирования
 * @param timezoneOffset - Смещение часового пояса от UTC в часах (например, 3 для МСК)
 * @returns Дата в формате YYYY-MM-DD
 */
export function formatDateToString(date: Date, timezoneOffset: number | null = null): string {
  // Если указан часовой пояс, применяем смещение
  if (timezoneOffset !== null) {
    // Получаем UTC время
    const utcTime = date.getTime() + (date.getTimezoneOffset() * 60000);
    // Применяем смещение часового пояса
    const localTime = new Date(utcTime + (timezoneOffset * 3600000));
    
    const year = localTime.getFullYear();
    const month = String(localTime.getMonth() + 1).padStart(2, '0');
    const day = String(localTime.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
  }
  
  // Если часовой пояс не указан, используем UTC
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}