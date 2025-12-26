import sharp from 'sharp';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import logger from './logger.js';

// Путь к файлу шрифта относительно корня проекта
// Используем process.cwd() для работы как в dev, так и в production
const fontPath = resolve(process.cwd(), 'assets/fonts/vintage-culture-font.ttf');

/**
 * Обрабатывает изображение: добавляет текст в формате "Jiroboy" (верхняя строка) и "Day X/30" (нижняя строка)
 * Текст позиционируется по центру горизонтально и в верхней 1/5 фото по вертикали
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
    
    // Масштабирование текста: текст должен занимать 80% ширины изображения, если позволяет высота
    // Приблизительная ширина текста: fontSize * количество_символов * коэффициент (≈0.6 для большинства шрифтов)
    const targetWidth = width * 0.8; // 80% ширины изображения
    
    // Определяем максимальную длину текста (берем более длинный текст)
    const maxTextLength = Math.max(topText.length, bottomText.length);
    
    // Коэффициент для приблизительного расчета ширины текста (зависит от шрифта, обычно 0.5-0.7)
    const textWidthCoefficient = 0.6;
    
    // Вычисляем размер шрифта для нижнего текста (обычно более длинный)
    // fontSize * maxTextLength * textWidthCoefficient = targetWidth
    let bottomFontSize = Math.round(targetWidth / (maxTextLength * textWidthCoefficient));
    
    // Размер верхнего текста пропорционален нижнему (сохраняем соотношение)
    let topFontSize = Math.round(bottomFontSize * 0.65);
    
    // Минимальные размеры для читаемости
    const minBottomFontSize = 24;
    const minTopFontSize = 16;
    
    // Проверяем ограничение по высоте: текст должен помещаться в верхней 1/5 фото
    const availableHeight = height / 5; // Верхняя 1/5 фото
    const textHeight = bottomFontSize + topFontSize + 20; // Общая высота текста с отступами
    
    // Если текст не помещается по высоте, уменьшаем размер пропорционально
    if (textHeight > availableHeight) {
      const scaleFactor = availableHeight / textHeight;
      bottomFontSize = Math.max(minBottomFontSize, Math.round(bottomFontSize * scaleFactor));
      topFontSize = Math.max(minTopFontSize, Math.round(topFontSize * scaleFactor));
    }
    
    // Применяем минимальные размеры, если они не соблюдены
    bottomFontSize = Math.max(minBottomFontSize, bottomFontSize);
    topFontSize = Math.max(minTopFontSize, topFontSize);
    
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
    
    // Позиционирование: текст по центру горизонтально, в верхней 1/5 по вертикали
    const centerX = width / 2; // Центр по горизонтали
    const verticalPosition = height / 5; // Верхняя 1/5 фото по вертикали
    const topTextY = verticalPosition - (bottomFontSize / 2) - 5; // Позиция верхнего текста
    const bottomTextY = verticalPosition + (bottomFontSize / 2) + 5; // Позиция нижнего текста
    
    const svgText = `
      <svg width="${width}" height="${height}">
        <defs>
          ${fontFace}
        </defs>
        <text 
          x="${centerX}" 
          y="${topTextY}" 
          class="top-text"
          text-anchor="middle"
          fill="white"
        >${escapedTopText}</text>
        <text 
          x="${centerX}" 
          y="${bottomTextY}" 
          class="bottom-text"
          text-anchor="middle"
          fill="white"
        >${escapedBottomText}</text>
      </svg>
    `;

    // Получаем среднюю яркость в верхней центральной области для определения цвета текста
    // Берем область примерно 30% от ширины по центру и 20% от высоты в верхней части (для двух строк текста)
    const cropWidth = Math.max(10, Math.floor(width * 0.3)); // 30% от ширины по центру
    const cropHeight = Math.max(10, Math.floor(height * 0.2)); // 20% от высоты в верхней части
    const cropLeft = Math.max(0, Math.floor((width - cropWidth) / 2)); // Центр по горизонтали
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
      logger.warn('Could not extract brightness from image top center area, using default');
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
