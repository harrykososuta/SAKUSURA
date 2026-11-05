export const fullCrop = () => ({ x: 0, y: 0, width: 1, height: 1 });
export function validCrop(crop) {
  return crop && typeof crop === 'object' && !Array.isArray(crop)
    && Object.keys(crop).length === 4 && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(crop[key]))
    && crop.x >= 0 && crop.y >= 0 && crop.width >= .01 && crop.height >= .01
    && crop.x + crop.width <= 1.000001 && crop.y + crop.height <= 1.000001;
}
export function croppedPoint(point, crop = fullCrop()) {
  return { x: (point.x - crop.x) / crop.width, y: (point.y - crop.y) / crop.height };
}
