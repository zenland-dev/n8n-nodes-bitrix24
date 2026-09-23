import type { IDataObject, IExecuteFunctions, ILoadOptionsFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { cached, CONFIG_TTL_MS } from './cache';
import { bitrix24Request, portalKey } from './transport';

/** The ID of the user the webhook acts as, memoised per portal. */
export async function webhookUserId(ctx: IExecuteFunctions | ILoadOptionsFunctions, itemIndex?: number): Promise<number> {
	const portal = await portalKey.call(ctx);
	return await cached(
		`profile:${portal}`,
		async () => {
			const body = await bitrix24Request.call(ctx, 'profile', {}, { itemIndex });
			const id = Number((body.result as IDataObject | null)?.ID ?? 0);
			if (!Number.isInteger(id) || id <= 0) {
				throw new NodeOperationError(ctx.getNode(), 'Bitrix24 did not say which user the webhook acts as', {
					itemIndex,
					description: 'The profile method answered without an ID. Check that the webhook is still valid.',
				});
			}
			return id;
		},
		CONFIG_TTL_MS,
	);
}
