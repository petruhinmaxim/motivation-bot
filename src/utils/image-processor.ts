import sharp from 'sharp';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import logger from './logger.js';

// Путь к файлу шрифта относительно корня проекта
// Используем process.cwd() для работы как в dev, так и в production
const fontPath = resolve(process.cwd(), 'assets/fonts/vintage-culture-font.ttf');

/**
 * Обрабатывает изображение: добавляет текст в формате "Jiroboy" (верхняя строка) и "Day X/30" (нижняя строка) в верхний правый угол
 * @param imageBuffer - Буфер изображения
 * @param dayNumber - Номер дня (successfulDays + 1)
 * @param totalDays - Общее количество дней (duration)
 * @returns Обработанное изображение в виде буфера
 */
export async function processImage(
  imageBuffer: Buffer,
  dayNumber: number,
  totalDays: number
): Promise<Buffer> {
  try {
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();
    const width = metadata.width || 1000;
    const height = metadata.height || 1000;

    // Тексты для наложения (экранируем для XML)
    const topText = 'Jiroboy';
    const bottomText = `Day ${dayNumber}/${totalDays}`;
    
    const escapeXml = (text: string) => text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
    
    const escapedTopText = escapeXml(topText);
    const escapedBottomText = escapeXml(bottomText);
    
    // Размеры шрифтов: верхний текст меньше, нижний больше
    const bottomFontSize = Math.max(32, Math.floor(height * 0.05)); // Больший размер для "Day X/30"
    const topFontSize = Math.max(20, Math.floor(bottomFontSize * 0.6)); // Меньший размер для "Jiroboy"
    
    // Загружаем кастомный шрифт и конвертируем в base64
    let fontBase64 = '';
    let fontFamily = 'Arial, sans-serif';
    
    try {
      const fontBuffer = readFileSync(fontPath);
      fontBase64 = fontBuffer.toString('base64');
      fontFamily = 'VintageCulture';
    } catch (error) {
      logger.warn('Could not load custom font, using Arial fallback:', error);
    }
    
    // Создаем SVG с двумя строками текста
    const fontFace = fontBase64 
      ? `<style>
          @font-face {
            font-family: 'VintageCulture';
            src: url('data:font/truetype;charset=utf-8;base64,${fontBase64}') format('truetype');
          }
          .top-text {
            font-family: 'VintageCulture', Arial, sans-serif;
            font-size: ${topFontSize}px;
            font-weight: bold;
          }
          .bottom-text {
            font-family: 'VintageCulture', Arial, sans-serif;
            font-size: ${bottomFontSize}px;
            font-weight: bold;
          }
        </style>`
      : `<style>
          .top-text {
            font-family: Arial, sans-serif;
            font-size: ${topFontSize}px;
            font-weight: bold;
          }
          .bottom-text {
            font-family: Arial, sans-serif;
            font-size: ${bottomFontSize}px;
            font-weight: bold;
          }
        </style>`;
    
    // Позиционирование: верхний текст выше, нижний ниже
    const padding = 20;
    const topTextY = topFontSize + padding;
    const bottomTextY = topTextY + bottomFontSize + 5; // Небольшой отступ между строками
    
    const svgText = `
      <svg width="${width}" height="${height}">
        <defs>
          ${fontFace}
        </defs>
        <text 
          x="${width - padding}" 
          y="${topTextY}" 
          class="top-text"
          text-anchor="end"
          fill="white"
        >${escapedTopText}</text>
        <text 
          x="${width - padding}" 
          y="${bottomTextY}" 
          class="bottom-text"
          text-anchor="end"
          fill="white"
        >${escapedBottomText}</text>
      </svg>
    `;

    // Получаем среднюю яркость в верхнем правом углу для определения цвета текста
    // Берем область примерно 25% от ширины и 12% от высоты в правом верхнем углу (для двух строк текста)
    const cropWidth = Math.max(10, Math.floor(width * 0.25));
    const cropHeight = Math.max(10, Math.floor(height * 0.12));
    const cropLeft = Math.max(0, width - cropWidth);
    
    let averageBrightness = 128; // Значение по умолчанию
    try {
      const stats = await image
        .clone()
        .extract({ left: cropLeft, top: 0, width: cropWidth, height: cropHeight })
        .resize(50, 50, { fit: 'inside' })
        .greyscale()
        .stats();
      
      averageBrightness = stats.channels[0]?.mean || 128;
    } catch (error) {
      // Если не удалось извлечь область, используем значение по умолчанию
      logger.warn('Could not extract brightness from image corner, using default');
    }
    
    // Если изображение темное (яркость < 128), используем белый текст, иначе черный
    // На фото текст черный без обводки, поэтому используем только fill
    const textColor = averageBrightness < 128 ? 'white' : 'black';
    
    // Обновляем SVG с правильным цветом (убираем обводку, как на фото)
    const svgWithColor = svgText.replace(
      /fill="white"/g,
      `fill="${textColor}"`
    );

    // Накладываем текст на изображение
    // Сохраняем исходный формат изображения
    const processedImage = await image
      .composite([
        {
          input: Buffer.from(svgWithColor),
          top: 0,
          left: 0,
        },
      ])
      .toBuffer();

    return processedImage;
  } catch (error) {
    logger.error('Error processing image:', error);
    throw error;
  }
}
