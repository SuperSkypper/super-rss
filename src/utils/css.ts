export function setDynamicCss(element: HTMLElement, properties: Record<string, string>): void {
    element.setCssProps(properties);
}
