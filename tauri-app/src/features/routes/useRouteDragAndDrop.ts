import { useState } from "react";

export function useRouteDragAndDrop(reorderWaypoint: (from: number, to: number) => void) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const getDragHandlers = (index: number, disabled: boolean) => ({
    draggable: !disabled,
    onDragStart: () => setDraggedIndex(index),
    onDragEnd: () => setDraggedIndex(null),
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (draggedIndex !== null && draggedIndex !== index) {
        reorderWaypoint(draggedIndex, index);
      }
      setDraggedIndex(null);
    }
  });

  return { draggedIndex, getDragHandlers };
}
