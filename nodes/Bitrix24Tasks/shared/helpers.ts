import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { numberProperty } from '../../../shared/props';
import { idList } from '../../../shared/values';

export { defined, idList, optionalInt, yn } from '../../../shared/values';

export const taskIdProperty = numberProperty('Task ID', 'taskId', 'ID of the task');

/** Reads a required positive number from a collection value or top-level parameter. */
export function requiredId(ctx: IExecuteFunctions, name: string, label: string, itemIndex: number, minimum = 1): number {
	const value = Number(ctx.getNodeParameter(name, itemIndex));
	if (!Number.isInteger(value) || value < minimum) {
		throw new NodeOperationError(ctx.getNode(), `${label} must be a whole number of at least ${minimum}`, { itemIndex });
	}
	return value;
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
