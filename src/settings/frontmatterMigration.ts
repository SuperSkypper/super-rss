import type { FrontmatterPropertyTemplate } from './settingsDefault';

function createMigratedPropertyId(name: string, index: number): string {
    return `legacy-${index}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'property'}`;
}

function stripYamlQuotes(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length < 2) return trimmed;
    const quote = trimmed[0];
    if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
        return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
    }
    return trimmed;
}

export function migrateLegacyFrontmatterTemplate(template: string): FrontmatterPropertyTemplate[] | null {
    const lines = template.split(/\r?\n/);
    const properties: FrontmatterPropertyTemplate[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (!line.trim()) continue;
        if (/^\s/.test(line)) return null;

        const match = line.match(/^([^:#][^:]*):(?:\s*(.*))?$/);
        if (!match) return null;

        const name = match[1]?.trim() ?? '';
        const inlineValue = match[2] ?? '';
        if (!name) return null;

        const blockValues: string[] = [];
        while (i + 1 < lines.length) {
            const next = lines[i + 1] ?? '';
            if (!next.trim()) {
                i++;
                continue;
            }
            const itemMatch = next.match(/^\s*-\s+(.*)$/);
            if (!itemMatch) break;
            blockValues.push(stripYamlQuotes(itemMatch[1] ?? ''));
            i++;
        }

        const value = blockValues.length > 0
            ? blockValues.join('\n')
            : stripYamlQuotes(inlineValue);

        properties.push({
            id:    createMigratedPropertyId(name, properties.length),
            name,
            type:  'text',
            value,
        });
    }

    return properties.length > 0 ? properties : null;
}
