import type { IDataObject, INodeExecutionData } from 'n8n-workflow';

import { normalizeBotToken, normalizeWebhookToken } from '../credentials/portalAddress';
import type { Bitrix24Context } from './transport';

/** What a string holding a credential secret turns into in workflow data. */
export const REMOVED_SECRET = '[removed: it contained the webhook secret]';

/** Shorter values are not treated as secrets: replacing them would mangle ordinary data. */
const MIN_SECRET_LENGTH = 8;

/**
 * The secrets of a credential that must never reach workflow data: the code of the webhook
 * (the part after the user ID) and, for the chatbot credential, the bot token.
 *
 * Bitrix24 puts the webhook code into signed download links: DOWNLOAD_URL on Drive,
 * urlMachine of CRM file fields (seen on a live portal, 15.09.2026), the uf.php link of an
 * attachment as auth[ap]. Any of them in an output hands the webhook to whoever sees it.
 */
export async function credentialSecrets(ctx: Bitrix24Context, credentialType: string): Promise<string[]> {
	let credentials: IDataObject;
	try {
		credentials = (await ctx.getCredentials(credentialType)) as IDataObject;
	} catch {
		return [];
	}
	const code = normalizeWebhookToken(credentials.webhookToken).split('/')[1] ?? '';
	return [code, normalizeBotToken(credentials.botToken)].filter((s) => s.length >= MIN_SECRET_LENGTH);
}

/** A copy of `value` where every string holding one of `secrets` is replaced by REMOVED_SECRET. */
export function scrubSecrets<T>(value: T, secrets: string[]): T {
	if (secrets.length === 0) return value;
	const walk = (v: unknown): unknown => {
		if (typeof v === 'string') return secrets.some((s) => v.includes(s)) ? REMOVED_SECRET : v;
		if (Array.isArray(v)) return v.map(walk);
		if (v !== null && typeof v === 'object') {
			const out: IDataObject = {};
			for (const [key, inner] of Object.entries(v as IDataObject)) out[key] = walk(inner) as IDataObject[keyof IDataObject];
			return out;
		}
		return v;
	};
	return walk(value) as T;
}

/** The same for output items: their JSON is scrubbed, binary data is left as it is. */
export function scrubItems(items: INodeExecutionData[], secrets: string[]): INodeExecutionData[] {
	if (secrets.length === 0) return items;
	return items.map((item) => ({ ...item, json: scrubSecrets(item.json, secrets) }));
}
