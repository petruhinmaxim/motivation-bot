/**
 * Возвращает случайный элемент массива.
 * Бросает ошибку, если массив пустой.
 */
export function pickRandom<T>(items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error('pickRandom: items array is empty');
  }
  const randomIndex = Math.floor(Math.random() * items.length);
  return items[randomIndex] as T;
}

