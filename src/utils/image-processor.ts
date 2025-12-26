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
    let image = sharp(imageBuffer);
    const metadata = await image.metadata();
    let width = metadata.width || 1000;
    let height = metadata.height || 1000;

    // Приводим изображение к вертикальному формату (высота > ширины)
    // Если изображение горизонтальное, поворачиваем его на 90 градусов
    if (width > height) {
      // Поворачиваем изображение на 90 градусов по часовой стрелке
      image = image.rotate(90);
      
      // После поворота ширина и высота меняются местами
      const tempWidth = width;
      width = height;
      height = tempWidth;
      
      logger.debug(`Rotated horizontal image to vertical: ${metadata.width}x${metadata.height} -> ${width}x${height}`);
    }

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
    
    // Масштабирование текста в зависимости от размера изображения
    // Используем среднее геометрическое ширины и высоты для более точного масштабирования
    // Например: для фото 1000x1000 => imageSize = 1000, для фото 2000x1500 => imageSize ≈ 1732
    const imageSize = Math.sqrt(width * height);
    
    // Диапазоны размеров изображений для масштабирования
    // Маленькие фото (например, 400x400 и меньше) и большие фото (например, 5000x5000 и больше)
    const minImageSize = 400;   // Порог для маленьких изображений
    const maxImageSize = 5000;  // Порог для больших изображений (ограничиваем максимальный размер текста)
    
    // Минимальные и максимальные размеры для читаемости
    const minBottomFontSize = 24;  // Минимум для нижнего текста
    const maxBottomFontSize = 120; // Максимум для нижнего текста
    const minTopFontSize = 16;     // Минимум для верхнего текста
    const maxTopFontSize = 72;     // Максимум для верхнего текста
    
    let bottomFontSize: number;
    let topFontSize: number;
    
    // Для очень маленьких изображений используем процент от высоты
    if (imageSize < minImageSize) {
      bottomFontSize = Math.max(minBottomFontSize, Math.floor(height * 0.06));
      topFontSize = Math.max(minTopFontSize, Math.floor(bottomFontSize * 0.65));
    } 
    // Для очень больших изображений используем максимальные размеры
    else if (imageSize > maxImageSize) {
      bottomFontSize = maxBottomFontSize;
      topFontSize = maxTopFontSize;
    } 
    // Для средних размеров используем линейную интерполяцию
    else {
      // Нормализуем размер изображения в диапазон [0, 1]
      const normalizedSize = (imageSize - minImageSize) / (maxImageSize - minImageSize);
      
      // Линейная интерполяция между минимальным и максимальным размером
      bottomFontSize = Math.round(
        minBottomFontSize + (maxBottomFontSize - minBottomFontSize) * normalizedSize
      );
      topFontSize = Math.round(
        minTopFontSize + (maxTopFontSize - minTopFontSize) * normalizedSize
      );
    }
    
    // Загружаем кастомный шрифт и конвертируем в base64
    let fontBase64 = '';
    
    try {
      const fontBuffer = readFileSync(fontPath);
      fontBase64 = fontBuffer.toString('base64');
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
    
    // Позиционирование: текст в верхнем правом углу
    const padding = Math.max(10, Math.floor(width * 0.02)); // Адаптивный отступ (2% от ширины, минимум 10px)
    const rightX = width - padding; // Позиция по правому краю
    const topTextY = topFontSize + padding; // Позиция верхнего текста (отступ от верха)
    const bottomTextY = topTextY + bottomFontSize + 5; // Нижний текст с небольшим отступом
    
    const svgText = `
      <svg width="${width}" height="${height}">
        <defs>
          ${fontFace}
        </defs>
        <text 
          x="${rightX}" 
          y="${topTextY}" 
          class="top-text"
          text-anchor="end"
          fill="white"
        >${escapedTopText}</text>
        <text 
          x="${rightX}" 
          y="${bottomTextY}" 
          class="bottom-text"
          text-anchor="end"
          fill="white"
        >${escapedBottomText}</text>
      </svg>
    `;

    // Получаем среднюю яркость в верхнем правом углу для определения цвета текста
    // Берем область примерно 25% от ширины и 15% от высоты в правом верхнем углу (для двух строк текста)
    const cropWidth = Math.max(10, Math.floor(width * 0.25)); // 25% от ширины в правом углу
    const cropHeight = Math.max(10, Math.floor(height * 0.15)); // 15% от высоты в верхней части
    const cropLeft = Math.max(0, width - cropWidth); // Правый край
    const cropTop = 0; // Верхняя часть
    
    let averageBrightness = 128; // Значение по умолчанию
    try {
      const stats = await image
        .clone()
        .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })
        .resize(50, 50, { fit: 'inside' })
        .greyscale()
        .stats();
      
      averageBrightness = stats.channels[0]?.mean || 128;
    } catch (error) {
      // Если не удалось извлечь область, используем значение по умолчанию
      logger.warn('Could not extract brightness from image top right corner, using default');
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
