// ─── Interfaces & Types ───────────────────────────────────────────────────────

export interface FeedItem {
    title:            string;
    link:             string;
    content:          string;
    description:      string;
    descriptionShort: string;
    author:           string;
    pubDate:          string;
    imageUrl:         string;
    categories:       string[];
    duration?:        string;
}

export interface FeedConfig {
    name:                  string;
    url:                   string;
    folder:                string;
    enabled:               boolean;
    lastUpdated?:          number;
    archived?:             boolean;
    deleted?:              boolean;
    deletedAt?:            number;
    groupId?:              string;
    previousName?:         string; // tracks last saved name to detect renames
    tagShorts?:            boolean;
    skipShorts?:           boolean;
    tagLive?:              boolean;
    deleteLives?:          boolean;
    titleTemplate?:        string;
    frontmatterTemplate?:  string;
    contentTemplate?:      string;
    updateIntervalValue?:  number;
    updateIntervalUnit?:   'minutes' | 'hours' | 'days' | 'months';
    autoCleanupValue?:     number;
    autoCleanupUnit?:      'minutes' | 'hours' | 'days' | 'months';
    autoCleanupDateField?: 'global' | 'datepub' | 'datesaved';
    extraFrontmatterRaw?:  string;
}

export interface FeedGroup {
    id:         string;
    name:       string;
    collapsed?: boolean;
}

export type FrontmatterPropertyType = 'text' | 'list' | 'number' | 'checkbox' | 'date' | 'datetime';
export type FrontmatterMode = 'properties' | 'source';

export interface FrontmatterPropertyTemplate {
    id:    string;
    name:  string;
    type:  FrontmatterPropertyType;
    value: string;
}

export type ImageLocation = 'obsidian' | 'vault' | 'current' | 'subfolder' | 'specified';
export type DeleteBehavior = 'obsidian' | 'direct' | 'obsidian-trash' | 'system-trash';

export interface PluginSettings {
    pluginEnabled:               boolean;
    folderPath:                  string;
    template:                    string;
    frontmatterTemplate:         string;
    frontmatterMode:             FrontmatterMode;
    frontmatterProperties:       FrontmatterPropertyTemplate[];
    fileNameTemplate:            string;
    updateIntervalValue:         number;
    updateIntervalUnit:          'minutes' | 'hours' | 'days' | 'months';
    autoCleanupValue:            number;
    autoCleanupUnit:             'minutes' | 'hours' | 'days' | 'months';
    autoCleanupDateField:        'datepub' | 'datesaved';
    autoCleanupCheckProperty:    boolean;
    autoCleanupCheckPropertyName: string;
    feeds:                       FeedConfig[];
    groups:                      FeedGroup[];
    deleteBehavior:              DeleteBehavior;
    downloadImages:              boolean;
    imageLocation:               ImageLocation;
    imagesFolder:                string;
    useFeedFolder:               boolean;
    tagShortsGlobal:             boolean;
    skipShortsGlobal:            boolean;
    tagLiveGlobal:               boolean;
    tagLiveKeywords:             string;
    devMode:                     boolean;
    showProgressNotice:          boolean;
    showStatusBar:               boolean;
    ribbonUpdate:                boolean;
    ribbonAdd:                   boolean;
    markAsReadEnabled:              boolean;
    markAsReadLinkProperty:         string;
    markAsReadCheckboxProperty:     string;
    markAsReadDeleteArticles:       boolean;
}

// ─── Template constants ───────────────────────────────────────────────────────

const DEFAULT_FILENAME_TEMPLATE = '{{title}}';

// All variables available in frontmatter scope:
// {{title}}, {{author}}, {{datepublished}}, {{datesaved}}, {{snippet}}, {{feedname}},
// {{link}}, {{image}}, {{ytduration}}, {{tags}}
const DEFAULT_FRONTMATTER_TEMPLATE =
`Title: {{title}}
Author: {{author}}
Feed: {{feedname}}
Link: {{link}}
Image: {{image}}
Duration: {{ytduration}}
Date Published: {{datepublished}}
Date Saved: {{datesaved}}
Snippet: {{snippet}}
Tags: {{tags}}`;

const DEFAULT_FRONTMATTER_PROPERTIES: FrontmatterPropertyTemplate[] = [
    { id: 'title',          name: 'Title',          type: 'text',     value: '{{title}}' },
    { id: 'author',         name: 'Author',         type: 'text',     value: '{{author}}' },
    { id: 'feed',           name: 'Feed',           type: 'text',     value: '{{feedname}}' },
    { id: 'link',           name: 'Link',           type: 'text',     value: '{{link}}' },
    { id: 'image',          name: 'Image',          type: 'text',     value: '{{image}}' },
    { id: 'duration',       name: 'Duration',       type: 'text',     value: '{{ytduration}}' },
    { id: 'date-published', name: 'Date Published', type: 'datetime', value: '{{datepublished}}' },
    { id: 'date-saved',     name: 'Date Saved',     type: 'datetime', value: '{{datesaved}}' },
    { id: 'snippet',        name: 'Snippet',        type: 'text',     value: '{{snippet}}' },
    { id: 'tags',           name: 'Tags',           type: 'list',     value: '{{tags}}' },
];

// All variables available in content scope (includes {{content}}):
const DEFAULT_CONTENT_TEMPLATE =
`{{image}}

{{content}}`;

// ─── Default settings ─────────────────────────────────────────────────────────
// These values are applied to new users on first install.
// Existing users keep their saved settings — only missing keys fall back here.

export const DEFAULT_SETTINGS: PluginSettings = {
    pluginEnabled:               false,
    folderPath:                  'RSS',
    fileNameTemplate:            DEFAULT_FILENAME_TEMPLATE,
    frontmatterTemplate:         DEFAULT_FRONTMATTER_TEMPLATE,
    frontmatterMode:             'properties',
    frontmatterProperties:       DEFAULT_FRONTMATTER_PROPERTIES,
    template:                    DEFAULT_CONTENT_TEMPLATE,
    updateIntervalValue:         60,
    updateIntervalUnit:          'minutes',
    autoCleanupValue:            0,
    autoCleanupUnit:             'days',
    autoCleanupDateField:        'datesaved',
    autoCleanupCheckProperty:    false,
    autoCleanupCheckPropertyName: 'Read',
    feeds:                       [],
    groups:                      [],
    deleteBehavior:              'obsidian',
    downloadImages:              false,
    imageLocation:               'obsidian',
    imagesFolder:                'attachments',
    useFeedFolder:               true,
    tagShortsGlobal:             false,
    skipShortsGlobal:            false,
    tagLiveGlobal:               false,
    tagLiveKeywords:             'live, ao vivo, stream, 🔴, streaming, livestream',
    devMode:                     false,
    showProgressNotice:          true,
    showStatusBar:               true,
    ribbonUpdate:                true,
    ribbonAdd:                   true,
    markAsReadEnabled:              true,
    markAsReadLinkProperty:         'Mark as Read',
    markAsReadCheckboxProperty:     'Read',
    markAsReadDeleteArticles:       false,
};
