import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/** Picker for any CRM object type, smart processes included. */
export function entityTypeProperty(
	description: string,
	name = 'entityTypeId',
	displayName = 'Entity Type Name or ID',
): INodeProperties {
	return {
		displayName,
		name,
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getEntityTypes' },
		required: true,
		default: 2,
		description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		hint: `${description}. IDs: 1 lead, 2 deal, 3 contact, 4 company, 7 quote, 31 invoice, 1000+ smart process.`,
	};
}

export function numberProperty(
	displayName: string,
	name: string,
	description: string,
	required = true,
): INodeProperties {
	return { displayName, name, type: 'number', required, default: 0, description };
}

export function stringProperty(
	displayName: string,
	name: string,
	description: string,
	required = false,
	placeholder?: string,
): INodeProperties {
	const property: INodeProperties = { displayName, name, type: 'string', required, default: '', description };
	if (placeholder !== undefined) property.placeholder = placeholder;
	return property;
}

export function jsonProperty(displayName: string, name: string, description: string, fallback = '{}'): INodeProperties {
	return { displayName, name, type: 'json', default: fallback, description };
}

/** A positive integer parameter; `label` names it in the error. */
export function positiveInt(ctx: IExecuteFunctions, name: string, itemIndex: number, label = name): number {
	const value = Number(ctx.getNodeParameter(name, itemIndex));
	if (!Number.isInteger(value) || value <= 0) {
		throw new NodeOperationError(ctx.getNode(), `${label} must be a positive whole number`, { itemIndex });
	}
	return value;
}

/** Wraps whatever `result` holds into one or more output rows. */
export function rows(result: unknown, key?: string): IDataObject | IDataObject[] {
	let value = result;
	if (key !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)) {
		value = (value as IDataObject)[key] ?? value;
	}
	if (Array.isArray(value)) {
		return value.map((v) => (v !== null && typeof v === 'object' ? (v as IDataObject) : { value: v as string }));
	}
	if (value !== null && typeof value === 'object') return value as IDataObject;
	return { result: value as string };
}
