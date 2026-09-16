import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/**
 * GETs a one-time download link Bitrix24 handed out and turns it into binary data.
 *
 * Through a webhook such a link is `/rest/<user>/<webhook code>/download/…` (seen on a
 * live portal for `im.v2.File.download`, 14.09.2026; the imbot.v2 docs show the same
 * form): the link carries the webhook secret. So it is fetched only from the portal it
 * belongs to, and neither the link nor anything built from it reaches output or errors.
 */
export async function downloadToBinary(
	ctx: IExecuteFunctions,
	options: {
		url: string;
		portal: string;
		fileId: number;
		itemIndex: number;
		binaryProperty: string;
		json: IDataObject;
		/** The name to use when the portal sends no Content-Disposition, e.g. NAME from Drive. */
		fallbackName?: string;
	},
): Promise<INodeExecutionData> {
	const { url, portal, fileId, itemIndex } = options;
	let origin = '';
	try {
		origin = new URL(url).origin;
	} catch {
		origin = '';
	}
	if (origin === '' || origin !== new URL(portal).origin) {
		throw new NodeOperationError(ctx.getNode(), 'The download link does not point at the portal', { itemIndex });
	}

	let response: IDataObject;
	try {
		response = (await ctx.helpers.httpRequest({ method: 'GET', url, encoding: 'arraybuffer', returnFullResponse: true, ignoreHttpStatusErrors: true })) as IDataObject;
	} catch {
		throw new NodeOperationError(ctx.getNode(), `File ${fileId} could not be downloaded: the portal did not answer`, { itemIndex });
	}
	const status = Number(response.statusCode) || 0;
	if (status < 200 || status >= 300) {
		throw new NodeOperationError(ctx.getNode(), `File ${fileId} could not be downloaded: HTTP ${status}`, { itemIndex });
	}

	const headers = (response.headers ?? {}) as IDataObject;
	const buffer = Buffer.from(response.body as ArrayBuffer);
	const fileName = fileNameFrom(headers['content-disposition']) ?? options.fallbackName ?? `file-${fileId}`;
	const mimeType = String(headers['content-type'] ?? 'application/octet-stream').split(';')[0];
	return {
		json: { ...options.json, fileId, fileName, size: buffer.length },
		binary: { [options.binaryProperty]: await ctx.helpers.prepareBinaryData(buffer, fileName, mimeType) },
		pairedItem: { item: itemIndex },
	};
}

/** The file name from a Content-Disposition header, RFC 5987 form first. */
function fileNameFrom(disposition: unknown): string | undefined {
	const text = String(disposition ?? '');
	const extended = text.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
	if (extended) {
		try {
			return decodeURIComponent(extended[1].trim().replace(/^"|"$/g, ''));
		} catch {
			return undefined;
		}
	}
	const plain = text.match(/filename="?([^";]+)"?/i);
	return plain ? plain[1] : undefined;
}
