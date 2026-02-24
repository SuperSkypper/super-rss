import { setIcon } from 'obsidian';

export interface DragDropContext {
    dragSrcIndex: number | null;
    feeds: any[];
    onDrop: (fromIndex: number, toIndex: number) => Promise<void>;
}

export function attachDragDrop(
    settingEl: HTMLElement,
    index: number,
    ctx: DragDropContext
): void {
    settingEl.draggable = true;

    const dragHandle = createDiv();
    dragHandle.style.cssText = 'cursor: grab; margin-right: 15px; color: var(--text-muted); display: flex; align-items: center;';
    setIcon(dragHandle, 'grip-vertical');
    settingEl.prepend(dragHandle);

    const dropIndicator = createDiv();
    dropIndicator.style.cssText = `
        position: absolute; left: 0; right: 0; top: -8px; height: 4px;
        background: var(--interactive-accent); display: none;
        pointer-events: none; z-index: 20; border-radius: 2px;
        box-shadow: 0 0 8px var(--interactive-accent);
    `;
    settingEl.appendChild(dropIndicator);

    let dragCounter = 0;

    settingEl.addEventListener('dragstart', (e) => {
        ctx.dragSrcIndex = index;
        settingEl.style.opacity = '0.4';
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });

    settingEl.addEventListener('dragend', () => {
        settingEl.style.opacity = '1';
        ctx.dragSrcIndex = null;
        dropIndicator.style.display = 'none';
        dragCounter = 0;
    });

    settingEl.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        if (ctx.dragSrcIndex !== null && ctx.dragSrcIndex !== index) {
            dropIndicator.style.display = 'block';
        }
    });

    settingEl.addEventListener('dragleave', () => {
        dragCounter--;
        if (dragCounter === 0) dropIndicator.style.display = 'none';
    });

    settingEl.addEventListener('dragover', (e) => { e.preventDefault(); return false; });

    settingEl.addEventListener('drop', async (e) => {
        e.preventDefault();
        if (ctx.dragSrcIndex !== null && ctx.dragSrcIndex !== index) {
            await ctx.onDrop(ctx.dragSrcIndex, index);
        }
    });
}