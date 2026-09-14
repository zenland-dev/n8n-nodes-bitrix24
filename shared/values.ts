import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { stringList } from './params';

/** Bitrix24's Y/N flags from a boolean parameter; undefined stays undefined. */
export function yn(value: unknown): 'Y' | 'N' | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	return value === true || value === 'Y' || value === 1 || value === '1' ? 'Y' : 'N';
}

/** "3, 17" or [3, 17] into positive integers; anything else is refused by name. */
export function idList(ctx: IExecuteFunctions, value: unknown, label: string, itemIndex: number): number[] {
	return stringList(value).map((text) => {
		const id = Number(text);
		if (!Number.isInteger(id) || id <= 0) {
			throw new NodeOperationError(ctx.getNode(), `${label}: "${text}" is not a user or record ID`, { itemIndex });
		}
		return id;
	});
}

/** An optional whole number from a collection: 0, empty and junk mean "not given". */
export function optionalInt(value: unknown): number | undefined {
	const n = Number(value);
	return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Drops keys whose value is undefined; keeps false, 0 and empty strings the user set on purpose. */
export function defined(object: IDataObject): IDataObject {
	const out: IDataObject = {};
	for (const [key, value] of Object.entries(object)) if (value !== undefined) out[key] = value;
	return out;
}
