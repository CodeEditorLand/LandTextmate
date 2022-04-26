/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { isValidHexColor, OrMask, strArrCmp, strcmp } from './utils';


/**
 * A TextMate theme.
 */
 export interface IRawTheme {
	readonly name?: string;
	readonly settings: IRawThemeSetting[];
}

/**
 * Identifiers with a binary dot operator.
 * Examples: `baz` or `foo.bar`
*/
export type ScopeName = string;

/**
 * An expression language of ScopeNames with a binary space (to indicate nesting) operator.
 * Examples: `foo.bar boo.baz`
*/
export type ScopePathStr = string;

/**
 * An expression language of ScopePathStr with a binary comma (to indicate alternatives) operator.
 * Examples: `foo.bar boo.baz,quick quack`
*/
export type ScopePattern = string;


/**
 * A single theme setting.
 */
 export interface IRawThemeSetting {
	readonly name?: string;
	readonly scope?: ScopePattern | ScopePattern[];
	readonly settings: {
		readonly fontStyle?: string;
		readonly foreground?: string;
		readonly background?: string;
	};
}

export class Theme {
	public static createFromRawTheme(
		source: IRawTheme | undefined,
		colorMap?: string[]
	): Theme {
		return this.createFromParsedTheme(parseTheme(source), colorMap);
	}

	public static createFromParsedTheme(
		source: ParsedThemeRule[],
		colorMap?: string[]
	): Theme {
		return resolveParsedThemeRules(source, colorMap);
	}

	private readonly _cache = new Map<ScopeName, ThemeTrieElementRule[]>();

	constructor(
		private readonly _colorMap: ColorMap,
		private readonly _defaults: StyleInfo,
		private readonly _root: ThemeTrieElement
	) {}

	public getColorMap(): string[] {
		return this._colorMap.getColorMap();
	}

	public getDefaults(): StyleInfo {
		return this._defaults;
	}

	public match(scopePath: ScopePath | null): StyleInfo | null {
		if (scopePath === null) {
			return this._defaults;
		}
		const scopeName = scopePath.scopeName;

		if (!this._cache.has(scopeName)) {
			this._cache.set(scopeName, this._root.match(scopeName));
		}
		const cachedValue = this._cache.get(scopeName)!;

		const effectiveRule = cachedValue.find(v => _matches(scopePath.parent, v.parentScopes));
		if (!effectiveRule) {
			return null;
		}

		return new StyleInfo(
			effectiveRule.fontStyle,
			effectiveRule.foreground,
			effectiveRule.background
		);
	}
}

export class ScopePath {
	public static from(first: ScopeName, ...segments: ScopeName[]): ScopePath;
	public static from(...segments: ScopeName[]): ScopePath | null;
	public static from(...segments: ScopeName[]): ScopePath | null {
		let result: ScopePath | null = null;
		for (let i = 0; i < segments.length; i++) {
			result = new ScopePath(result, segments[i]);
		}
		return result;
	}

	constructor(
		public readonly parent: ScopePath | null,
		public readonly scopeName: ScopeName
	) {}

	public push(scopeName: ScopeName): ScopePath {
		return new ScopePath(this, scopeName);
	}

	public getSegments(): ScopeName[] {
		let item: ScopePath | null = this;
		const result: ScopeName[] = [];
		while (item) {
			result.push(item.scopeName);
			item = item.parent;
		}
		result.reverse();
		return result;
	}

	public toString() {
		return this.getSegments().join(' ');
	}
}

function _matchesScope(scope: string, selector: string, selectorWithDot: string): boolean {
	return (selector === scope || scope.substring(0, selectorWithDot.length) === selectorWithDot);
}

function _matches(target: ScopePath | null, parentScopes: string[] | null): boolean {
	if (parentScopes === null) {
		return true;
	}

	const len = parentScopes.length;
	let index = 0;
	let selector = parentScopes[index];
	let selectorWithDot = selector + '.';

	while (target) {
		if (_matchesScope(target.scopeName, selector, selectorWithDot)) {
			index++;
			if (index === len) {
				return true;
			}
			selector = parentScopes[index];
			selectorWithDot = selector + '.';
		}
		target = target.parent;
	}

	return false;
}

export class StyleInfo {
	constructor(
		public readonly fontStyle: OrMask<FontStyle>,
		public readonly foreground: number,
		public readonly background: number
	) {}
}

/**
 * Parse a raw theme into rules.
 */
export function parseTheme(source: IRawTheme | undefined): ParsedThemeRule[] {
	if (!source) {
		return [];
	}
	if (!source.settings || !Array.isArray(source.settings)) {
		return [];
	}
	let settings = source.settings;
	let result: ParsedThemeRule[] = [], resultLen = 0;
	for (let i = 0, len = settings.length; i < len; i++) {
		let entry = settings[i];

		if (!entry.settings) {
			continue;
		}

		let scopes: string[];
		if (typeof entry.scope === 'string') {
			let _scope = entry.scope;

			// remove leading commas
			_scope = _scope.replace(/^[,]+/, '');

			// remove trailing commans
			_scope = _scope.replace(/[,]+$/, '');

			scopes = _scope.split(',');
		} else if (Array.isArray(entry.scope)) {
			scopes = entry.scope;
		} else {
			scopes = [''];
		}

		let fontStyle: OrMask<FontStyle> = FontStyle.NotSet;
		if (typeof entry.settings.fontStyle === 'string') {
			fontStyle = FontStyle.None;

			let segments = entry.settings.fontStyle.split(' ');
			for (let j = 0, lenJ = segments.length; j < lenJ; j++) {
				let segment = segments[j];
				switch (segment) {
					case 'italic':
						fontStyle = fontStyle | FontStyle.Italic;
						break;
					case 'bold':
						fontStyle = fontStyle | FontStyle.Bold;
						break;
					case 'underline':
						fontStyle = fontStyle | FontStyle.Underline;
						break;
					case 'strikethrough':
						fontStyle = fontStyle | FontStyle.Strikethrough;
						break;
				}
			}
		}

		let foreground: string | null = null;
		if (typeof entry.settings.foreground === 'string' && isValidHexColor(entry.settings.foreground)) {
			foreground = entry.settings.foreground;
		}

		let background: string | null = null;
		if (typeof entry.settings.background === 'string' && isValidHexColor(entry.settings.background)) {
			background = entry.settings.background;
		}

		for (let j = 0, lenJ = scopes.length; j < lenJ; j++) {
			let _scope = scopes[j].trim();

			let segments = _scope.split(' ');

			let scope = segments[segments.length - 1];
			let parentScopes: string[] | null = null;
			if (segments.length > 1) {
				parentScopes = segments.slice(0, segments.length - 1);
				parentScopes.reverse();
			}

			result[resultLen++] = new ParsedThemeRule(
				scope,
				parentScopes,
				i,
				fontStyle,
				foreground,
				background
			);
		}
	}

	return result;
}

export class ParsedThemeRule {
	constructor(
		public readonly scope: string,
		public readonly parentScopes: string[] | null,
		public readonly index: number,
		public readonly fontStyle: OrMask<FontStyle>,
		public readonly foreground: string | null,
		public readonly background: string | null,
	) {
	}
}

export const enum FontStyle {
	NotSet = -1,
	None = 0,
	Italic = 1,
	Bold = 2,
	Underline = 4,
	Strikethrough = 8
}

export function fontStyleToString(fontStyle: OrMask<FontStyle>) {
	if (fontStyle === FontStyle.NotSet) {
		return 'not set';
	}

	let style = '';
	if (fontStyle & FontStyle.Italic) {
		style += 'italic ';
	}
	if (fontStyle & FontStyle.Bold) {
		style += 'bold ';
	}
	if (fontStyle & FontStyle.Underline) {
		style += 'underline ';
	}
	if (fontStyle & FontStyle.Strikethrough) {
		style += 'strikethrough ';
	}
	if (style === '') {
		style = 'none';
	}
	return style.trim();
}

/**
 * Resolve rules (i.e. inheritance).
 */
function resolveParsedThemeRules(parsedThemeRules: ParsedThemeRule[], _colorMap: string[] | undefined): Theme {

	// Sort rules lexicographically, and then by index if necessary
	parsedThemeRules.sort((a, b) => {
		let r = strcmp(a.scope, b.scope);
		if (r !== 0) {
			return r;
		}
		r = strArrCmp(a.parentScopes, b.parentScopes);
		if (r !== 0) {
			return r;
		}
		return a.index - b.index;
	});

	// Determine defaults
	let defaultFontStyle = FontStyle.None;
	let defaultForeground = '#000000';
	let defaultBackground = '#ffffff';
	while (parsedThemeRules.length >= 1 && parsedThemeRules[0].scope === '') {
		let incomingDefaults = parsedThemeRules.shift()!;
		if (incomingDefaults.fontStyle !== FontStyle.NotSet) {
			defaultFontStyle = incomingDefaults.fontStyle;
		}
		if (incomingDefaults.foreground !== null) {
			defaultForeground = incomingDefaults.foreground;
		}
		if (incomingDefaults.background !== null) {
			defaultBackground = incomingDefaults.background;
		}
	}
	let colorMap = new ColorMap(_colorMap);
	let defaults = new StyleInfo(defaultFontStyle, colorMap.getId(defaultForeground), colorMap.getId(defaultBackground));

	let root = new ThemeTrieElement(new ThemeTrieElementRule(0, null, FontStyle.NotSet, 0, 0), []);
	for (let i = 0, len = parsedThemeRules.length; i < len; i++) {
		let rule = parsedThemeRules[i];
		root.insert(0, rule.scope, rule.parentScopes, rule.fontStyle, colorMap.getId(rule.foreground), colorMap.getId(rule.background));
	}

	return new Theme(colorMap, defaults, root);
}

export class ColorMap {
	private readonly _isFrozen: boolean;
	private _lastColorId: number;
	private _id2color: string[];
	private _color2id: { [color: string]: number; };

	constructor(_colorMap?: string[]) {
		this._lastColorId = 0;
		this._id2color = [];
		this._color2id = Object.create(null);

		if (Array.isArray(_colorMap)) {
			this._isFrozen = true;
			for (let i = 0, len = _colorMap.length; i < len; i++) {
				this._color2id[_colorMap[i]] = i;
				this._id2color[i] = _colorMap[i];
			}
		} else {
			this._isFrozen = false;
		}
	}

	public getId(color: string | null): number {
		if (color === null) {
			return 0;
		}
		color = color.toUpperCase();
		let value = this._color2id[color];
		if (value) {
			return value;
		}
		if (this._isFrozen) {
			throw new Error(`Missing color in color map - ${color}`);
		}
		value = ++this._lastColorId;
		this._color2id[color] = value;
		this._id2color[value] = color;
		return value;
	}

	public getColorMap(): string[] {
		return this._id2color.slice(0);
	}
}

export class ThemeTrieElementRule {

	scopeDepth: number;
	parentScopes: ScopeName[] | null;
	fontStyle: number;
	foreground: number;
	background: number;

	constructor(scopeDepth: number, parentScopes: ScopeName[] | null, fontStyle: number, foreground: number, background: number) {
		this.scopeDepth = scopeDepth;
		this.parentScopes = parentScopes;
		this.fontStyle = fontStyle;
		this.foreground = foreground;
		this.background = background;
	}

	public clone(): ThemeTrieElementRule {
		return new ThemeTrieElementRule(this.scopeDepth, this.parentScopes, this.fontStyle, this.foreground, this.background);
	}

	public static cloneArr(arr:ThemeTrieElementRule[]): ThemeTrieElementRule[] {
		let r: ThemeTrieElementRule[] = [];
		for (let i = 0, len = arr.length; i < len; i++) {
			r[i] = arr[i].clone();
		}
		return r;
	}

	public acceptOverwrite(scopeDepth: number, fontStyle: number, foreground: number, background: number): void {
		if (this.scopeDepth > scopeDepth) {
			console.log('how did this happen?');
		} else {
			this.scopeDepth = scopeDepth;
		}
		// console.log('TODO -> my depth: ' + this.scopeDepth + ', overwriting depth: ' + scopeDepth);
		if (fontStyle !== FontStyle.NotSet) {
			this.fontStyle = fontStyle;
		}
		if (foreground !== 0) {
			this.foreground = foreground;
		}
		if (background !== 0) {
			this.background = background;
		}
	}
}

export interface ITrieChildrenMap {
	[segment: string]: ThemeTrieElement;
}

export class ThemeTrieElement {
	private readonly _rulesWithParentScopes: ThemeTrieElementRule[];

	constructor(
		private readonly _mainRule: ThemeTrieElementRule,
		rulesWithParentScopes: ThemeTrieElementRule[] = [],
		private readonly _children: ITrieChildrenMap = {}
	) {
		this._rulesWithParentScopes = rulesWithParentScopes;
	}

	private static _sortBySpecificity(arr: ThemeTrieElementRule[]): ThemeTrieElementRule[] {
		if (arr.length === 1) {
			return arr;
		}
		arr.sort(this._cmpBySpecificity);
		return arr;
	}

	private static _cmpBySpecificity(a: ThemeTrieElementRule, b: ThemeTrieElementRule): number {
		if (a.scopeDepth === b.scopeDepth) {
			const aParentScopes = a.parentScopes;
			const bParentScopes = b.parentScopes;
			let aParentScopesLen = aParentScopes === null ? 0 : aParentScopes.length;
			let bParentScopesLen = bParentScopes === null ? 0 : bParentScopes.length;
			if (aParentScopesLen === bParentScopesLen) {
				for (let i = 0; i < aParentScopesLen; i++) {
					const aLen = aParentScopes![i].length;
					const bLen = bParentScopes![i].length;
					if (aLen !== bLen) {
						return bLen - aLen;
					}
				}
			}
			return bParentScopesLen - aParentScopesLen;
		}
		return b.scopeDepth - a.scopeDepth;
	}

	public match(scope: ScopeName): ThemeTrieElementRule[] {
		if (scope === '') {
			return ThemeTrieElement._sortBySpecificity((<ThemeTrieElementRule[]>[]).concat(this._mainRule).concat(this._rulesWithParentScopes));
		}

		let dotIndex = scope.indexOf('.');
		let head: string;
		let tail: string;
		if (dotIndex === -1) {
			head = scope;
			tail = '';
		} else {
			head = scope.substring(0, dotIndex);
			tail = scope.substring(dotIndex + 1);
		}

		if (this._children.hasOwnProperty(head)) {
			return this._children[head].match(tail);
		}

		return ThemeTrieElement._sortBySpecificity((<ThemeTrieElementRule[]>[]).concat(this._mainRule).concat(this._rulesWithParentScopes));
	}

	public insert(scopeDepth: number, scope: ScopeName, parentScopes: ScopeName[] | null, fontStyle: number, foreground: number, background: number): void {
		if (scope === '') {
			this._doInsertHere(scopeDepth, parentScopes, fontStyle, foreground, background);
			return;
		}

		let dotIndex = scope.indexOf('.');
		let head: string;
		let tail: string;
		if (dotIndex === -1) {
			head = scope;
			tail = '';
		} else {
			head = scope.substring(0, dotIndex);
			tail = scope.substring(dotIndex + 1);
		}

		let child: ThemeTrieElement;
		if (this._children.hasOwnProperty(head)) {
			child = this._children[head];
		} else {
			child = new ThemeTrieElement(this._mainRule.clone(), ThemeTrieElementRule.cloneArr(this._rulesWithParentScopes));
			this._children[head] = child;
		}

		child.insert(scopeDepth + 1, tail, parentScopes, fontStyle, foreground, background);
	}

	private _doInsertHere(scopeDepth: number, parentScopes: ScopeName[] | null, fontStyle: number, foreground: number, background: number): void {

		if (parentScopes === null) {
			// Merge into the main rule
			this._mainRule.acceptOverwrite(scopeDepth, fontStyle, foreground, background);
			return;
		}

		// Try to merge into existing rule
		for (let i = 0, len = this._rulesWithParentScopes.length; i < len; i++) {
			let rule = this._rulesWithParentScopes[i];

			if (strArrCmp(rule.parentScopes, parentScopes) === 0) {
				// bingo! => we get to merge this into an existing one
				rule.acceptOverwrite(scopeDepth, fontStyle, foreground, background);
				return;
			}
		}

		// Must add a new rule

		// Inherit from main rule
		if (fontStyle === FontStyle.NotSet) {
			fontStyle = this._mainRule.fontStyle;
		}
		if (foreground === 0) {
			foreground = this._mainRule.foreground;
		}
		if (background === 0) {
			background = this._mainRule.background;
		}

		this._rulesWithParentScopes.push(new ThemeTrieElementRule(scopeDepth, parentScopes, fontStyle, foreground, background));
	}
}
