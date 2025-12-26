import sharp from 'sharp';
import { resolve } from 'path';
import { readFileSync } from 'fs';
// @ts-ignore - opentype.js не имеет типов
import opentype from 'opentype.js';
import logger from './logger.js';

// Путь к файлу шрифта относительно корня проекта
// Используем process.cwd() для работы как в dev, так и в production
const fontPath = resolve(process.cwd(), 'assets/fonts/Vintage Culture.ttf');

// Загружаем шрифт один раз при загрузке модуля
let font: opentype.Font;
try {
  const fontBuffer = readFileSync(fontPath);
  font = opentype.parse(fontBuffer.buffer);
  logger.info(`Font loaded: "${font.getEnglishName('fullName')}" from ${fontPath}`);
} catch (error) {
  logger.error(`Failed to load font from ${fontPath}:`, error);
  throw new Error(`Font file not found or cannot be read: ${fontPath}`);
}

/**
 * Конвертирует текст в SVG path используя opentype.js
 * @param text - Текст для конвертации
 * @param fontSize - Размер шрифта
 * @param centerX - Центр текста по X (для центрирования)
 * @param y - Позиция Y (базовая линия)
 * @returns SVG path строка
 */
function textToPath(text: string, fontSize: number, centerX: number, y: number): string {
  try {
    // Вычисляем ширину текста для центрирования
    const path = font.getPath(text, 0, 0, fontSize);
    const bbox = path.getBoundingBox();
    const textWidth = bbox.x2 - bbox.x1;
    
    // Вычисляем начальную позицию для центрирования
    const startX = centerX - textWidth / 2;
    
    // Создаем path с правильной позицией
    const positionedPath = font.getPath(text, startX, y, fontSize);
    return positionedPath.toSVG(2); // 2 - количество знаков после запятой
  } catch (error) {
    logger.error(`Error converting text to path: "${text}":`, error);
    // Fallback: возвращаем простой text элемент
    return `<text x="${centerX}" y="${y}" font-size="${fontSize}" text-anchor="middle" fill="white">${text}</text>`;
  }
}

/**
 * Обрабатывает изображение: добавляет текст "Jiroboy" над цифрой "30" в тексте "Day X/30"
 * "Day X/30" выровнен по центру изображения, "Jiroboy" центрирован относительно "30"
 * Весь блок расположен в верхней 1/5 фото по вертикали
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

    // Тексты для наложения
    const topText = 'Jiroboy';
    const bottomText = `Day ${dayNumber}/${totalDays}`;
    const numberText = totalDays.toString();

    // Минимальные размеры для читаемости
    const minBottomFontSize = 24;
    const minTopFontSize = 16;

    // Масштабирование: "Day X/30" должен занимать 80% ширины изображения, если позволяет высота
    const targetWidth = width * 0.8; // 80% ширины изображения

    // Вычисляем размер шрифта для "Day X/30" методом подбора
    let bottomFontSize = Math.round(targetWidth / bottomText.length * 0.6); // Начальное приближение
    bottomFontSize = Math.max(minBottomFontSize, bottomFontSize);
    
    // Используем opentype для точного измерения ширины текста
    let measuredWidth = 0;
    try {
      const bottomPath = font.getPath(bottomText, 0, 0, bottomFontSize);
      const bottomBbox = bottomPath.getBoundingBox();
      measuredWidth = bottomBbox.x2 - bottomBbox.x1;
    } catch (error) {
      // Fallback: используем приблизительный расчет
      measuredWidth = bottomFontSize * bottomText.length * 0.6;
    }
    
    // Подгоняем размер шрифта, чтобы текст занимал примерно 80% ширины
    while (measuredWidth < targetWidth * 0.95 && bottomFontSize < height / 4) {
      bottomFontSize += 2;
      try {
        const path = font.getPath(bottomText, 0, 0, bottomFontSize);
        const bbox = path.getBoundingBox();
        measuredWidth = bbox.x2 - bbox.x1;
      } catch (error) {
        measuredWidth = bottomFontSize * bottomText.length * 0.6;
      }
    }
    while (measuredWidth > targetWidth * 1.05 && bottomFontSize > minBottomFontSize) {
      bottomFontSize -= 2;
      try {
        const path = font.getPath(bottomText, 0, 0, bottomFontSize);
        const bbox = path.getBoundingBox();
        measuredWidth = bbox.x2 - bbox.x1;
      } catch (error) {
        measuredWidth = bottomFontSize * bottomText.length * 0.6;
      }
    }

    // Вычисляем ширину "30" при текущем размере шрифта
    const dayPrefix = `Day ${dayNumber}/`;
    let numberWidth = 0;
    let dayPrefixWidth = 0;
    
    try {
      const numberPath = font.getPath(numberText, 0, 0, bottomFontSize);
      const numberBbox = numberPath.getBoundingBox();
      numberWidth = numberBbox.x2 - numberBbox.x1;
      
      const prefixPath = font.getPath(dayPrefix, 0, 0, bottomFontSize);
      const prefixBbox = prefixPath.getBoundingBox();
      dayPrefixWidth = prefixBbox.x2 - prefixBbox.x1;
    } catch (error) {
      // Fallback
      numberWidth = bottomFontSize * numberText.length * 0.6;
      dayPrefixWidth = bottomFontSize * dayPrefix.length * 0.6;
    }

    // Вычисляем размер шрифта для "Jiroboy", чтобы его ширина была равна ширине "30"
    let topFontSize = bottomFontSize;
    let topTextWidth = 0;
    
    try {
      const topPath = font.getPath(topText, 0, 0, topFontSize);
      const topBbox = topPath.getBoundingBox();
      topTextWidth = topBbox.x2 - topBbox.x1;
      
      if (topTextWidth > 0) {
        topFontSize = Math.round((bottomFontSize * numberWidth) / topTextWidth);
        topFontSize = Math.max(minTopFontSize, Math.min(topFontSize, bottomFontSize));
      }
    } catch (error) {
      topFontSize = Math.round((bottomFontSize * numberWidth) / (topText.length * 0.6));
      topFontSize = Math.max(minTopFontSize, Math.min(topFontSize, bottomFontSize));
    }

    // Проверяем ограничение по высоте: текст должен помещаться в верхней 1/5 фото
    const availableHeight = height / 5; // Верхняя 1/5 фото
    const textHeight = topFontSize + bottomFontSize; // Общая высота текста (без отступа)

    // Если текст не помещается по высоте, уменьшаем размер пропорционально
    if (textHeight > availableHeight) {
      const scaleFactor = availableHeight / textHeight;
      bottomFontSize = Math.max(minBottomFontSize, Math.round(bottomFontSize * scaleFactor));
      topFontSize = Math.max(minTopFontSize, Math.round(topFontSize * scaleFactor));
      
      // Пересчитываем ширины с новым размером
      try {
        const prefixPath = font.getPath(dayPrefix, 0, 0, bottomFontSize);
        const prefixBbox = prefixPath.getBoundingBox();
        dayPrefixWidth = prefixBbox.x2 - prefixBbox.x1;
      } catch (error) {
        dayPrefixWidth = bottomFontSize * dayPrefix.length * 0.6;
      }
    }

    // Получаем среднюю яркость в верхней центральной области для определения цвета текста
    const cropWidth = Math.max(10, Math.floor(width * 0.3));
    const cropHeight = Math.max(10, Math.floor(height * 0.2));
    const cropLeft = Math.max(0, Math.floor((width - cropWidth) / 2));
    const cropTop = 0;
    
    let averageBrightness = 128;
    try {
      const stats = await image
        .clone()
        .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })
        .resize(50, 50, { fit: 'inside' })
        .greyscale()
        .stats();
      
      averageBrightness = stats.channels[0]?.mean || 128;
    } catch (error) {
      logger.warn('Could not extract brightness from image top center area, using default');
    }

    // Если изображение темное (яркость < 128), используем белый текст, иначе черный
    const textColor = averageBrightness < 128 ? 'white' : 'black';
    logger.debug(`Text color: ${textColor} (brightness: ${averageBrightness.toFixed(2)})`);

    // Позиционирование: "Day X/30" по центру, "Jiroboy" над "30"
    const centerX = width / 2;
    const verticalPosition = height / 5;

    // Вычисляем позицию "30" в центрированном тексте "Day X/30"
    // Центр "30" = centerX + dayPrefixWidth / 2
    const numberCenterX = centerX + dayPrefixWidth / 2;

    // Позиция "Day X/30" (базовая линия текста)
    const bottomTextY = verticalPosition;

    // Позиция "Jiroboy": уменьшаем вертикальный отступ между "30" и "Jiroboy"
    const baseOffset = bottomFontSize;
    const reduction = topFontSize * 0.1;
    const topTextY = bottomTextY - baseOffset + reduction;

    // Конвертируем текст в SVG paths
    // Для "Jiroboy" - центрируем относительно "30"
    const topTextPath = textToPath(topText, topFontSize, numberCenterX, topTextY);
    
    // Для "Day X/30" - центрируем по центру изображения
    const bottomTextPath = textToPath(bottomText, bottomFontSize, centerX, bottomTextY);

    // Создаем SVG с путями вместо текста
    const svgText = `<?xml version="1.0" encoding="UTF-8"?>
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <g fill="${textColor}">
          ${topTextPath}
          ${bottomTextPath}
        </g>
      </svg>`;

    logger.info(`Text rendered as SVG paths: topText="${topText}" (${topFontSize}px), bottomText="${bottomText}" (${bottomFontSize}px), color=${textColor}`);

    // Накладываем текст на изображение через Sharp
    const processedImage = await image
      .composite([
        {
          input: Buffer.from(svgText),
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
