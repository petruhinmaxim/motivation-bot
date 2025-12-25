import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Получаем директорию текущего файла (для ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Получает путь к изображению для пропущенного дня
 * @param daysWithoutWorkout - количество пропущенных дней (1, 2 или 3)
 * @returns Путь к файлу изображения
 */
export function getMissedDayImagePath(daysWithoutWorkout: number): string {
  // Ограничиваем значение от 1 до 3
  const day = Math.max(1, Math.min(3, daysWithoutWorkout));
  
  // Путь относительно корня проекта
  // __dirname указывает на src/utils, поэтому нужно подняться на два уровня вверх
  const projectRoot = join(__dirname, '..', '..');
  return join(projectRoot, 'assets', 'missed-days', `day-${day}.png`);
}
