import { useRef, useState } from 'react';
import type { GestureResponderEvent, LayoutChangeEvent } from 'react-native';
import type { PdfRegion } from '@/lib/templateMappings';

type Point = { x: number; y: number };

export function usePdfRegionSelection(
  region: PdfRegion | null,
  onRegionSelected: (region: PdfRegion) => void,
) {
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [dragRegion, setDragRegion] = useState<PdfRegion | null>(null);
  const dragStart = useRef<Point | null>(null);
  const activeRegion = dragRegion ?? region;

  const onLayout = (event: LayoutChangeEvent) => {
    setDimensions({
      width: event.nativeEvent.layout.width,
      height: event.nativeEvent.layout.height,
    });
  };

  const getLocalPoint = (event: GestureResponderEvent): Point => ({
    x: Math.max(0, Math.min(dimensions.width, event.nativeEvent.locationX)),
    y: Math.max(0, Math.min(dimensions.height, event.nativeEvent.locationY)),
  });

  const updateDragRegion = (point: Point) => {
    const start = dragStart.current;
    if (!start || !dimensions.width || !dimensions.height) return;
    setDragRegion({
      left: Math.min(start.x, point.x) / dimensions.width,
      top: Math.min(start.y, point.y) / dimensions.height,
      right: Math.max(start.x, point.x) / dimensions.width,
      bottom: Math.max(start.y, point.y) / dimensions.height,
    });
  };

  const onResponderGrant = (event: GestureResponderEvent) => {
    dragStart.current = getLocalPoint(event);
    updateDragRegion(getLocalPoint(event));
  };

  const onResponderMove = (event: GestureResponderEvent) => {
    updateDragRegion(getLocalPoint(event));
  };

  const onResponderRelease = (event: GestureResponderEvent) => {
    const start = dragStart.current;
    const point = getLocalPoint(event);
    dragStart.current = null;
    if (!start || !dimensions.width || !dimensions.height) return;

    const minimumWidth = 0.025;
    const minimumHeight = 0.012;
    const left = Math.min(start.x, point.x) / dimensions.width;
    const top = Math.min(start.y, point.y) / dimensions.height;
    let right = Math.max(start.x, point.x) / dimensions.width;
    let bottom = Math.max(start.y, point.y) / dimensions.height;
    if (right - left < minimumWidth) right = Math.min(1, left + minimumWidth);
    if (bottom - top < minimumHeight) bottom = Math.min(1, top + minimumHeight);

    setDragRegion(null);
    onRegionSelected({ left, top, right, bottom });
  };

  const onResponderTerminate = () => {
    dragStart.current = null;
    setDragRegion(null);
  };

  return {
    activeRegion,
    dimensions,
    onLayout,
    onResponderGrant,
    onResponderMove,
    onResponderRelease,
    onResponderTerminate,
  };
}
