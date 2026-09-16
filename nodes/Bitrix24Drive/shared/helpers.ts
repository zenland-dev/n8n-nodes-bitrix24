import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { downloadToBinary } from '../../../shared/download';
import { asNodeError } from '../../../shared/errors';
import { extractRows, PAGE_SIZE } from '../../../shared/list';
import { jsonParameter } from '../../../shared/params';
import { numberProperty, positiveInt } from '../../../shared/props';
import { bitrix24Request, portalKey } from '../../../shared/transport';

/**
 * Drive answers carry DOWNLOAD_URL on every file, version and attachment. It is a signed
 * link: for an application it holds the access token, for a webhook the portal hands out
 * the same kind of link as im.v2.File.download, which carries the webhook code. It never
 * reaches output; Download fetches it inside the operation instead.
 */
const LINK_KEYS = new Set(['DOWNLOAD_URL', 'downloadUrl', 'urlMachine']);

export function withoutLink(row: unknown): IDataObject {
	if (row === null || typeof row !== 'object' || Array.isArray(row)) return { result: row as string };
	const out: IDataObject = {};
	for (const [key, value] of Object.entries(row as IDataObject)) if (!LINK_KEYS.has(key)) out[key] = value;
	return out;
}

export function withoutLinks(rows: unknown): IDataObject[] {
	return (Array.isArray(rows) ? rows : []).map(withoutLink);
}

export const storageIdProperty = numberProperty('Storage ID', 'storageId', 'ID of the storage, as Storage → Get Many or Get by Owner returns it');
export const folderIdProperty = numberProperty('Folder ID', 'folderId', 'ID of the folder. The root folder of a storage is its ROOT_OBJECT_ID.');
export const fileIdProperty = numberProperty('File ID', 'fileId', 'ID of the file on Drive');
export const targetFolderIdProperty = numberProperty('Target Folder ID', 'targetFolderId', 'ID of the folder to put it into');

export function readId(ctx: IExecuteFunctions, name: string, itemIndex: number, label: string): number {
	return positiveInt(ctx, name, itemIndex, label);
}

/** The result object of a Drive write, or an error naming what Bitrix24 answered instead. */
export function objectResult(ctx: IExecuteFunctions, result: unknown, what: string, itemIndex: number): IDataObject {
	if (result !== null && typeof result === 'object' && !Array.isArray(result)) return withoutLink(result);
	throw new NodeOperationError(ctx.getNode(), `Bitrix24 did not ${what}`, {
		itemIndex,
		description: `The answer was ${JSON.stringify(result)}. Moving between different storages, for example, answers false.`,
	});
}

/** Rows of a Drive list method, page by page with Bitrix24's start/next offsets. */
export async function offsetRows(
	ctx: IExecuteFunctions,
	method: string,
	params: IDataObject,
	options: { limit?: number; itemIndex: number; maxStart?: number },
): Promise<IDataObject[]> {
	const rows: IDataObject[] = [];
	let start = 0;
	for (;;) {
		const body = await bitrix24Request.call(ctx, method, { ...params, start }, { itemIndex: options.itemIndex });
		const page = extractRows(body.result);
		rows.push(...page);
		if (options.limit !== undefined && rows.length >= options.limit) return rows.slice(0, options.limit);
		const next = Number(body.next);
		if (page.length < PAGE_SIZE || !Number.isFinite(next) || next <= start) return rows;
		// disk.file.search caps start at 1000 and would repeat its last page forever.
		if (options.maxStart !== undefined && next > options.maxStart) return rows;
		start = next;
	}
}

export function limitOf(ctx: IExecuteFunctions, itemIndex: number): number | undefined {
	return (ctx.getNodeParameter('returnAll', itemIndex) as boolean) ? undefined : (ctx.getNodeParameter('limit', itemIndex) as number);
}

export function filterJsonProperty(example: string): INodeProperties {
	return {
		displayName: 'Filter (JSON)',
		name: 'filterJson',
		type: 'json',
		default: '{}',
		description: `Extra filter merged over the fields above. Compare with &gt;, &gt;=, &lt;, &lt;= or ! in front of a field, % means contains, and a list in square brackets matches any of its values, e.g. ${example}. Bitrix24 drops what it does not support without an error, the @ prefix included, so check the result.`,
	};
}

export function orderJsonProperty(example: string): INodeProperties {
	return {
		displayName: 'Order (JSON)',
		name: 'orderJson',
		type: 'json',
		default: '{}',
		description: `Sort object of field names and ASC or DESC, e.g. ${example}`,
	};
}

export function jsonObject(ctx: IExecuteFunctions, name: string, itemIndex: number): IDataObject {
	return jsonParameter<IDataObject>(ctx, name, itemIndex, {});
}

/** Access rights of a new file or folder: [{TASK_ID, ACCESS_CODE}]. */
export const rightsProperty: INodeProperties = {
	displayName: 'Access Rights',
	name: 'rights',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	placeholder: 'Add Access Right',
	default: {},
	description: 'Who else gets access, on top of the rights inherited from the folder',
	options: [
		{
			displayName: 'Access Right',
			name: 'right',
			values: [
				{
					displayName: 'Access Code',
					name: 'accessCode',
					type: 'string',
					default: '',
					placeholder: 'U35',
					description: 'U35 for user 35, D12 for everyone in department 12, DR12 for the department with its subdepartments, * for everyone',
				},
				{
					displayName: 'Access Level Name or ID',
					name: 'taskId',
					type: 'options',
					typeOptions: { loadOptionsMethod: 'getAccessLevels' },
					default: '',
					description:
						'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				},
			],
		},
	],
};

export function readRights(ctx: IExecuteFunctions, itemIndex: number, path: string): IDataObject[] {
	const entries = (ctx.getNodeParameter(path, itemIndex, []) ?? []) as IDataObject[];
	return entries
		.filter((e) => String(e.accessCode ?? '').trim() !== '' && String(e.taskId ?? '') !== '')
		.map((e) => ({ TASK_ID: Number(e.taskId), ACCESS_CODE: String(e.accessCode).trim() }));
}

/** A link Bitrix24 gave, made absolute: attachment links may start with /bitrix/…. */
function absolute(url: string, portal: string): string {
	return url.startsWith('/') ? `${portal}${url}` : url;
}

/**
 * Download operations share this: read the object, take its DOWNLOAD_URL, fetch it into
 * binary data. The link stays inside; the metadata goes out without it.
 */
export function downloadExecutor(
	read: (ctx: IExecuteFunctions, itemIndex: number) => Promise<{ id: number; meta: IDataObject }>,
): (this: IExecuteFunctions) => Promise<INodeExecutionData[]> {
	return async function (this: IExecuteFunctions): Promise<INodeExecutionData[]> {
		const out: INodeExecutionData[] = [];
		const portal = await portalKey.call(this);
		const items = this.getInputData();
		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const { id, meta } = await read(this, itemIndex);
				const url = String(meta.DOWNLOAD_URL ?? '');
				if (url === '') throw new NodeOperationError(this.getNode(), `Bitrix24 gave no download link for ${id}`, { itemIndex });
				const binaryProperty = String(this.getNodeParameter('binaryProperty', itemIndex));
				const item = await downloadToBinary(this, {
					url: absolute(url, portal),
					portal,
					fileId: id,
					itemIndex,
					binaryProperty,
					json: withoutLink(meta),
					fallbackName: typeof meta.NAME === 'string' && meta.NAME !== '' ? meta.NAME : undefined,
				});
				out.push(item);
			} catch (error) {
				if (!this.continueOnFail()) throw asNodeError(this.getNode(), error, itemIndex);
				out.push({ json: { error: error instanceof Error ? error.message : String(error) }, pairedItem: { item: itemIndex } });
			}
		}
		return out;
	};
}

export const outputBinaryProperty: INodeProperties = {
	displayName: 'Put Output File in Field',
	name: 'binaryProperty',
	type: 'string',
	required: true,
	default: 'data',
	hint: 'The name of the output binary field to put the file in',
};

export const inputBinaryProperty: INodeProperties = {
	displayName: 'Input Binary Field',
	name: 'binaryProperty',
	type: 'string',
	required: true,
	default: 'data',
	hint: 'The name of the input binary field containing the file to be uploaded',
};

interface WallParts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}

function wallParts(date: Date, timeZone: string): WallParts {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-GB', {
			timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hourCycle: 'h23',
		})
			.formatToParts(date)
			.map((p) => [p.type, p.value]),
	);
	return { year: +parts.year, month: +parts.month, day: +parts.day, hour: +parts.hour, minute: +parts.minute, second: +parts.second };
}

const pad = (n: number): string => String(n).padStart(2, '0');
const wallText = (p: WallParts): string => `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;

/** An instant from the value of a dateTime parameter; a value without an offset is in `timeZone`. */
function instantOf(value: string, timeZone: string): Date | undefined {
	if (/(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? undefined : date;
	}
	const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
	if (!m) return undefined;
	const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
	const seen = wallParts(new Date(guess), timeZone);
	const offset = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second) - guess;
	return new Date(guess - offset);
}

/**
 * A date for a Drive filter. Drive compares the value as a wall-clock time in the webhook
 * user's time zone and does not read offsets: a value ending in Z or in a UTC offset matched
 * nothing, while the same moment written as local time without an offset matched to the minute
 * (seen on a live portal, 15.09.2026). The zone comes from `profile`; a user without one works in the portal's
 * time zone, whose offset `server.time` shows.
 */
export async function driveFilterDate(ctx: IExecuteFunctions, value: unknown, itemIndex: number): Promise<string | undefined> {
	const text = String(value ?? '').trim();
	if (text === '') return undefined;
	const instant = instantOf(text, ctx.getTimezone());
	if (instant === undefined) throw new NodeOperationError(ctx.getNode(), `"${text}" is not a date`, { itemIndex });

	const profile = await bitrix24Request.call(ctx, 'profile', {}, { itemIndex });
	const zone = String((profile.result as IDataObject | null)?.TIME_ZONE ?? '');
	if (zone !== '') {
		try {
			return wallText(wallParts(instant, zone));
		} catch {
			// An IANA name this Node.js does not know: fall back to the portal offset below.
		}
	}
	const time = await bitrix24Request.call(ctx, 'server.time', {}, { itemIndex });
	const offset = String(time.result ?? '').match(/([+-])(\d{2}):?(\d{2})$/);
	const minutes = offset ? (offset[1] === '-' ? -1 : 1) * (+offset[2] * 60 + +offset[3]) : 0;
	return wallText(wallParts(new Date(instant.getTime() + minutes * 60_000), 'UTC'));
}

/** getFields answers {NAME: {TYPE, USE_IN_FILTER, USE_IN_SHOW}}: one row per field. */
export function fieldRows(result: unknown): IDataObject[] {
	const fields = (result ?? {}) as IDataObject;
	return Object.entries(fields).map(([name, meta]) => ({ name, ...((meta ?? {}) as IDataObject) }));
}
