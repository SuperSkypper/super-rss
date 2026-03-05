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

export type ImageLocation = 'obsidian' | 'vault' | 'current' | 'subfolder' | 'specified';

export interface PluginSettings {
    pluginEnabled:               boolean;
    folderPath:                  string;
    template:                    string;
    frontmatterTemplate:         string;
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
}

// ─── Template constants ───────────────────────────────────────────────────────

const DEFAULT_FILENAME_TEMPLATE = '{{title}}';

// All variables available in frontmatter scope:
// {{title}}, {{author}}, {{datepub}}, {{datesaved}}, {{snippet}}, {{feedname}},
// {{link}}, {{image}}, {{duration}}, {{#tags}}
const DEFAULT_FRONTMATTER_TEMPLATE =
`Title: {{title}}
Author: {{author}}
Feed: {{feedname}}
Link: {{link}}
Image: {{image}}
Duration: {{duration}}
Date Published: {{datepub}}
Date Saved: {{datesaved}}
Snippet: {{snippet}}
Tags: {{#tags}}`;

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
    template:                    DEFAULT_CONTENT_TEMPLATE,
    updateIntervalValue:         60,
    updateIntervalUnit:          'minutes',
    autoCleanupValue:            0,
    autoCleanupUnit:             'days',
    autoCleanupDateField:        'datesaved',
    autoCleanupCheckProperty:    false,
    autoCleanupCheckPropertyName: 'Mark as Read',
    feeds:                       [],
    groups:                      [],
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
    markAsReadCheckboxProperty:     'Checkbox',
};