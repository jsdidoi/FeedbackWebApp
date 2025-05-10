import React, { useEffect, useRef, useState } from 'react';
// import { fabric } from 'fabric'; // Previous attempt
import * as fabric from 'fabric'; // Using wildcard import
import { Loader2, ZoomIn, ZoomOut, Move, Square, Type, Edit3, Trash2, Save, Palette, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button'; // Added Button import

interface AnnotationCanvasProps {
  imageUrl: string;
  initialAnnotations?: string; // JSON string of fabric canvas state
  onSaveAnnotations: (annotations: string) => void;
  // TODO: Add other necessary props like image dimensions, user permissions for editing, etc.
}

// Using fabric.TOptions<fabric.TPointerEvent> for event handlers

const AnnotationCanvas: React.FC<AnnotationCanvasProps> = ({
  imageUrl,
  initialAnnotations,
  onSaveAnnotations,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvasRef = useRef<fabric.Canvas | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTool, setActiveTool] = useState<'select' | 'rectangle' | 'freehand' | 'text'>('select');
  const [fillColor, setFillColor] = useState('#000000'); // Default fill color for text, shapes
  const [strokeColor, setStrokeColor] = useState('#ff0000'); // Default stroke color for shapes
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [zoomLevel, setZoomLevel] = useState(1); // Added for zoom
  
  // Refs for drawing state for rectangle tool
  const isDrawingRectRef = useRef(false);
  const rectStartXRef = useRef(0);
  const rectStartYRef = useRef(0);
  const currentRectRef = useRef<fabric.Rect | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !imageUrl) {
      setIsLoading(false);
      if (fabricCanvasRef.current) {
        fabricCanvasRef.current.dispose();
        fabricCanvasRef.current = null;
      }
      return;
    }
    setIsLoading(true);

    const canvasElement = canvasRef.current;
    if (fabricCanvasRef.current) {
      fabricCanvasRef.current.dispose();
    }

    const newFabricCanvas = new fabric.Canvas(canvasElement, {
      backgroundColor: 'transparent',
    });
    fabricCanvasRef.current = newFabricCanvas;
    
    // Set initial tool mode
    setCanvasToolMode(newFabricCanvas, activeTool);

    // Corrected fabric.Image.fromURL usage:
    // Callback is the second argument, options (like crossOrigin) is the third.
    fabric.Image.fromURL(imageUrl, 
      (img: fabric.Image, isError?: boolean) => {
        if (isError || !img || !fabricCanvasRef.current || !img.width || img.width <= 0 || !img.height || img.height <= 0) {
          console.error("Error loading image, canvas not ready, or image has invalid (zero/negative) dimensions.");
          setIsLoading(false);
          return;
        }

        const canvas = fabricCanvasRef.current;
        canvas.setWidth(img.width);
        canvas.setHeight(img.height);

        img.set({
          originX: 'left',
          originY: 'top',
        });
        
        canvas.backgroundImage = img;
        canvas.renderAll();

        if (initialAnnotations) {
          try {
            canvas.loadFromJSON(JSON.parse(initialAnnotations), () => {
              canvas.renderAll();
              setIsLoading(false);
            });
          } catch (error) {
            console.error("Error loading initial annotations:", error);
            setIsLoading(false);
          }
        } else {
          setIsLoading(false);
        }

        setupCanvasEventListeners(newFabricCanvas);
      },
      { crossOrigin: 'anonymous' } // Pass as plain object for imageOptions
    );

    return () => {
      if (fabricCanvasRef.current) {
        fabricCanvasRef.current.dispose();
        fabricCanvasRef.current = null;
      }
    };
  }, [imageUrl, initialAnnotations]);

  useEffect(() => {
    if (fabricCanvasRef.current) {
      setCanvasToolMode(fabricCanvasRef.current, activeTool);
    }
    document.addEventListener('keydown', handleDeleteKeyPress);
    return () => {
      document.removeEventListener('keydown', handleDeleteKeyPress);
    };
  }, [activeTool, strokeColor, strokeWidth, fillColor]); // Added color/width dependencies for freeDrawingBrush updates

  const setCanvasToolMode = (canvas: fabric.Canvas, tool: string) => {
    canvas.isDrawingMode = tool === 'freehand';
    if (tool === 'freehand') {
      if (canvas.freeDrawingBrush) { // Null check
        canvas.freeDrawingBrush.color = strokeColor;
        canvas.freeDrawingBrush.width = strokeWidth;
      }
    }
    canvas.selection = tool === 'select' || tool === 'text'; 
    canvas.forEachObject((obj: fabric.Object) => {
      obj.selectable = tool === 'select' || tool === 'text';
      obj.evented = tool === 'select' || tool === 'text';
    });

    if (tool !== 'rectangle') {
        isDrawingRectRef.current = false;
        if (currentRectRef.current) {
            canvas.remove(currentRectRef.current);
            currentRectRef.current = null;
        }
    }
    canvas.renderAll();
  };

  const setupCanvasEventListeners = (canvas: fabric.Canvas) => {
    canvas.on('mouse:down', (opt: fabric.TOptions<fabric.TPointerEvent>) => { 
      if (opt.pointer && activeTool === 'rectangle' && !opt.target) {
        isDrawingRectRef.current = true;
        const pointer = opt.pointer;
        rectStartXRef.current = pointer.x;
        rectStartYRef.current = pointer.y;
        
        const rect = new fabric.Rect({
          left: rectStartXRef.current,
          top: rectStartYRef.current,
          width: 0,
          height: 0,
          fill: 'transparent',
          stroke: strokeColor,
          strokeWidth: strokeWidth,
          selectable: false,
          evented: false,
        });
        currentRectRef.current = rect;
        canvas.add(rect);
      }
      if (opt.pointer && activeTool === 'text' && !opt.target) {
        const pointer = opt.pointer;
        const text = new fabric.IText('Editable Text', {
          left: pointer.x,
          top: pointer.y,
          fontFamily: 'Arial',
          fontSize: 20,
          fill: fillColor,
          editable: true,
        });
        canvas.add(text);
        canvas.setActiveObject(text);
        text.enterEditing();
      }
    });

    canvas.on('mouse:move', (opt: fabric.TOptions<fabric.TPointerEvent>) => { 
      if (opt.pointer && activeTool === 'rectangle' && isDrawingRectRef.current && currentRectRef.current) {
        const pointer = opt.pointer;
        let width = pointer.x - rectStartXRef.current;
        let height = pointer.y - rectStartYRef.current;
        let newLeft = rectStartXRef.current;
        let newTop = rectStartYRef.current;

        if (width < 0) {
          newLeft = pointer.x;
          width = Math.abs(width);
        }
        if (height < 0) {
          newTop = pointer.y;
          height = Math.abs(height);
        }

        currentRectRef.current.set({
          left: newLeft,
          top: newTop,
          width: width,
          height: height,
        });
        canvas.renderAll();
      }
    });

    canvas.on('mouse:up', (opt: fabric.TOptions<fabric.TPointerEvent>) => { 
      if (activeTool === 'rectangle' && isDrawingRectRef.current && currentRectRef.current) {
        isDrawingRectRef.current = false;
        currentRectRef.current.set({
            selectable: true,
            evented: true
        });
        currentRectRef.current = null; 
      }
      // Potentially handle other mouse:up events or tool-specific logic here
      // For example, if selecting an object, mouse:up might finalize selection.
    });
  };

  const handleDeleteSelected = () => {
    if (fabricCanvasRef.current) {
      const activeObjects = fabricCanvasRef.current.getActiveObjects();
      if (activeObjects.length > 0) {
        activeObjects.forEach((obj: fabric.Object) => fabricCanvasRef.current?.remove(obj));
        fabricCanvasRef.current.discardActiveObject();
        fabricCanvasRef.current.renderAll();
      }
    }
  };

  const handleDeleteKeyPress = (event: KeyboardEvent) => {
    if (fabricCanvasRef.current && (event.key === 'Delete' || event.key === 'Backspace')) {
      const activeElement = document.activeElement;
      if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.getAttribute('contenteditable') === 'true')) {
        return; 
      }
      handleDeleteSelected();
      event.preventDefault();
    }
  };

  const handleSaveCanvas = () => {
    if (fabricCanvasRef.current) {
      const json = JSON.stringify(fabricCanvasRef.current.toDatalessJSON());
      onSaveAnnotations(json); 
    }
  };

  const handleZoomIn = () => {
    if (fabricCanvasRef.current && fabricCanvasRef.current.getWidth() > 0 && fabricCanvasRef.current.getHeight() > 0) {
      const newZoom = Math.min(zoomLevel * 1.2, 5);
      fabricCanvasRef.current.zoomToPoint(new fabric.Point(fabricCanvasRef.current.getWidth() / 2, fabricCanvasRef.current.getHeight() / 2), newZoom);
      setZoomLevel(newZoom);
    }
  };

  const handleZoomOut = () => {
    if (fabricCanvasRef.current && fabricCanvasRef.current.getWidth() > 0 && fabricCanvasRef.current.getHeight() > 0) {
      const newZoom = Math.max(zoomLevel / 1.2, 0.2);
      fabricCanvasRef.current.zoomToPoint(new fabric.Point(fabricCanvasRef.current.getWidth() / 2, fabricCanvasRef.current.getHeight() / 2), newZoom);
      setZoomLevel(newZoom);
    }
  };

  const handleResetZoom = () => {
    if (fabricCanvasRef.current && fabricCanvasRef.current.getWidth() > 0 && fabricCanvasRef.current.getHeight() > 0) {
      fabricCanvasRef.current.zoomToPoint(new fabric.Point(fabricCanvasRef.current.getWidth() / 2, fabricCanvasRef.current.getHeight() / 2), 1);
      setZoomLevel(1);
      fabricCanvasRef.current.setViewportTransform([1, 0, 0, 1, 0, 0]);
    }
  };

  const handlePan = (deltaX: number, deltaY: number) => {
    if (fabricCanvasRef.current) {
      fabricCanvasRef.current.relativePan(new fabric.Point(deltaX, deltaY));
    }
  };

  if (isLoading && imageUrl) {
    return <div className="w-full h-full flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /> Loading Canvas...</div>;
  }
  
  if(!imageUrl) {
    return <div className="w-full h-full flex items-center justify-center">Please provide an image URL.</div>;
  }

  return (
    <div className="w-full h-full relative bg-gray-100 flex flex-col items-stretch">
      <div className="p-2 bg-slate-100 border-b border-slate-300 shadow-sm flex flex-wrap items-center gap-1 text-xs z-10">
        <Button title="Select/Edit (V)" variant={activeTool === 'select' ? 'secondary' : 'ghost'} size="icon" onClick={() => setActiveTool('select')}><Move className="h-4 w-4" /></Button>
        <Button title="Draw Rectangle (R)" variant={activeTool === 'rectangle' ? 'secondary' : 'ghost'} size="icon" onClick={() => setActiveTool('rectangle')}><Square className="h-4 w-4" /></Button>
        <Button title="Freehand Draw (P)" variant={activeTool === 'freehand' ? 'secondary' : 'ghost'} size="icon" onClick={() => setActiveTool('freehand')}><Edit3 className="h-4 w-4" /></Button>
        <Button title="Draw Text (T)" variant={activeTool === 'text' ? 'secondary' : 'ghost'} size="icon" onClick={() => setActiveTool('text')}><Type className="h-4 w-4" /></Button>
        <div className="h-5 border-l border-slate-300 mx-1"></div>
        <div className="flex items-center gap-1 p-1 rounded-md hover:bg-slate-200" title="Fill Color">
            <Palette className="h-4 w-4 text-slate-600" />
            <input type="color" value={fillColor} onChange={(e) => setFillColor(e.target.value)} className="w-5 h-5 border-none bg-transparent p-0 cursor-pointer" />
        </div>
        <div className="flex items-center gap-1 p-1 rounded-md hover:bg-slate-200" title="Stroke Color">
            <Palette className="h-4 w-4 text-slate-600" style={{ strokeWidth: 2, stroke: strokeColor === fillColor ? (fillColor === '#ffffff' ? '#000000' : '#ffffff') : 'currentColor' }} />
            <input type="color" value={strokeColor} onChange={(e) => setStrokeColor(e.target.value)} className="w-5 h-5 border-none bg-transparent p-0 cursor-pointer" />
        </div>
        <div className="flex items-center gap-1 p-1 rounded-md hover:bg-slate-200" title="Stroke Width">
            <Minus className="h-3 w-3 text-slate-600 cursor-pointer" onClick={() => setStrokeWidth(Math.max(1, strokeWidth -1))} />
            <input 
                type="number" 
                value={strokeWidth} 
                onChange={(e) => setStrokeWidth(Math.max(1, parseInt(e.target.value, 10) || 1))} 
                className="w-8 text-center border border-slate-300 rounded-sm text-xs p-0.5 bg-white"
            />
            <Plus className="h-3 w-3 text-slate-600 cursor-pointer" onClick={() => setStrokeWidth(strokeWidth + 1)} />
        </div>
        <div className="h-5 border-l border-slate-300 mx-1"></div>
        <Button title="Zoom In" variant="ghost" size="icon" onClick={handleZoomIn}><ZoomIn className="h-4 w-4" /></Button>
        <Button title="Zoom Out" variant="ghost" size="icon" onClick={handleZoomOut}><ZoomOut className="h-4 w-4" /></Button>
        <Button title="Reset Zoom/Pan" variant="ghost" size="icon" onClick={handleResetZoom}>1:1</Button>
        <div className="h-5 border-l border-slate-300 mx-1"></div>
        <Button title="Delete Selected (Del/Backspace)" variant="ghost" size="icon" onClick={handleDeleteSelected} className="text-red-600 hover:text-red-700 hover:bg-red-100"><Trash2 className="h-4 w-4" /></Button>
        <Button title="Save Annotations" variant="ghost" size="icon" onClick={handleSaveCanvas} className="text-green-600 hover:text-green-700 hover:bg-green-100"><Save className="h-4 w-4" /></Button>
      </div>
      <div className="flex-1 w-full h-full overflow-auto p-2 bg-gray-200">
        <canvas ref={canvasRef} className="rounded shadow-lg" />
      </div>
    </div>
  );
};

export default AnnotationCanvas; 