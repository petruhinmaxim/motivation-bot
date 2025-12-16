import sharp from 'sharp';
import logger from './logger.js';

/**
 * Обрабатывает изображение: добавляет текст "Жиробой день X из Y" в верхний правый угол
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

    // Текст для наложения (экранируем для XML)
    const text = `Жиробой день ${dayNumber} из ${totalDays}`;
    const escapedText = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
    
    // Размер шрифта (примерно 4% от высоты изображения)
    const fontSize = Math.max(24, Math.floor(height * 0.04));
    
    // Создаем SVG с текстом
    const svgText = `
      <svg width="${width}" height="${height}">
        <defs>
          <style>
            .text {
              font-family: Arial, sans-serif;
              font-size: ${fontSize}px;
              font-weight: bold;
            }
          </style>
        </defs>
        <text 
          x="${width - 20}" 
          y="${fontSize + 20}" 
          class="text"
          text-anchor="end"
          fill="white"
          stroke="black"
          stroke-width="2"
        >${escapedText}</text>
      </svg>
    `;

    // Получаем среднюю яркость в верхнем правом углу для определения цвета текста
    // Берем область примерно 20% от ширины и 15% от высоты в правом верхнем углу
    const cropWidth = Math.max(10, Math.floor(width * 0.2));
    const cropHeight = Math.max(10, Math.floor(height * 0.15));
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
    const textColor = averageBrightness < 128 ? 'white' : 'black';
    const strokeColor = averageBrightness < 128 ? 'black' : 'white';
    
    // Обновляем SVG с правильным цветом
    const svgWithColor = svgText.replace(
      'fill="white"',
      `fill="${textColor}"`
    ).replace(
      'stroke="black"',
      `stroke="${strokeColor}"`
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
