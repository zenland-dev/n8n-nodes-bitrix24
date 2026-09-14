import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';

import { jsonValue } from './params';

/** Shared by every node that posts messenger messages: the messenger itself and open lines. */
export const ATTACH_DESCRIPTION =
	'Rich card under the text, e.g. {"COLOR_TOKEN": "primary", "BLOCKS": [{"MESSAGE": "[B]New request[/B]"}, {"LINK": {"NAME": "Open", "LINK": "https://example.com"}}]}. A bare array of blocks works too.';
export const KEYBOARD_DESCRIPTION =
	'Buttons under the message, e.g. {"BUTTONS": [{"TEXT": "Open site", "LINK": "https://example.com"}, {"TYPE": "NEWLINE"}, {"TEXT": "Reply", "ACTION": "PUT", "ACTION_VALUE": "/help"}]}. Buttons with only COMMAND are dropped: those need a bot.';
export const MENU_DESCRIPTION = 'Extra items in the message context menu, e.g. {"ITEMS": [{"TEXT": "Open deal", "LINK": "https://example.com/deal/1"}]}';

/** A JSON field of a collection: text, object or array; empty means not given. */
export function optionalJson(ctx: IExecuteFunctions, raw: unknown, label: string, itemIndex: number): IDataObject | IDataObject[] | undefined {
	const value = jsonValue<IDataObject | IDataObject[] | undefined>(ctx, raw, label, itemIndex, undefined);
	if (value === undefined || value === null) return undefined;
	if (Array.isArray(value)) return value.length > 0 ? value : undefined;
	return typeof value === 'object' && Object.keys(value).length > 0 ? value : undefined;
}
