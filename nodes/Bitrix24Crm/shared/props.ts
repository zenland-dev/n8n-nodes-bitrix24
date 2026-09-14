import type { INodeProperties } from 'n8n-workflow';

export { jsonProperty, numberProperty, positiveInt, rows, stringProperty } from '../../../shared/props';

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
