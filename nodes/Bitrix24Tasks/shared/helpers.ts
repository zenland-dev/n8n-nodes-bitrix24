import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { stringList } from '../../../shared/params';
import { numberProperty } from '../../../shared/props';

export const taskIdProperty = numberProperty('Task ID', 'taskId', 'ID of the task');

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

/** Reads a required positive number from a collection value or top-level parameter. */
export function requiredId(ctx: IExecuteFunctions, name: string, label: string, itemIndex: number, minimum = 1): number {
	const value = Number(ctx.getNodeParameter(name, itemIndex));
	if (!Number.isInteger(value) || value < minimum) {
		throw new NodeOperationError(ctx.getNode(), `${label} must be a whole number of at least ${minimum}`, { itemIndex });
	}
	return value;
}

/** Drops keys whose value is undefined; keeps false, 0 and empty strings the user set on purpose. */
export function defined(object: IDataObject): IDataObject {
	const out: IDataObject = {};
	for (const [key, value] of Object.entries(object)) if (value !== undefined) out[key] = value;
	return out;
}

/** The body of a REST 3.0 answer: `result.item`, `result.items` or `result` itself. */
export function v3Result(body: IDataObject, key?: 'item' | 'items'): IDataObject | IDataObject[] {
	const result = body.result;
	if (result === null || typeof result !== 'object') return { result: result as boolean };
	if (key !== undefined && key in (result as IDataObject)) return (result as IDataObject)[key] as IDataObject | IDataObject[];
	return result as IDataObject;
}

/** Picker of workgroups. The description must be this literal for the linter; the rest goes in `hint`. */
export function workgroupProperty(name: string, displayName: string, hint: string, required = true): INodeProperties {
	return {
		displayName,
		name,
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getWorkgroups' },
		required,
		default: '',
		description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		hint,
	};
}

/**
 * Flow teams and task creators are lists of [type, id] pairs: ["user", "3"],
 * ["department", "17:F"]. A department without ":F" takes in its sub-departments.
 */
export function entityPairs(
	ctx: IExecuteFunctions,
	users: unknown,
	departments: unknown,
	withSubDepartments: boolean,
	itemIndex: number,
): string[][] {
	const pairs = idList(ctx, users, 'User IDs', itemIndex).map((id) => ['user', String(id)]);
	for (const id of idList(ctx, departments, 'Department IDs', itemIndex)) {
		pairs.push(['department', withSubDepartments ? String(id) : `${id}:F`]);
	}
	return pairs;
}
