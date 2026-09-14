import type { IExecuteFunctions, ILoadOptionsFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/** System CRM object types and the IDs Bitrix24 gives them. */
export const ENTITY_TYPE = {
	lead: 1,
	deal: 2,
	contact: 3,
	company: 4,
	quote: 7,
	invoice: 31,
} as const;

export type SystemEntity = keyof typeof ENTITY_TYPE;

/** Resource values whose items live in crm.item.* and the type each stands for. */
export const ITEM_RESOURCES: Record<string, number | 'smartProcess'> = {
	lead: ENTITY_TYPE.lead,
	deal: ENTITY_TYPE.deal,
	contact: ENTITY_TYPE.contact,
	company: ENTITY_TYPE.company,
	quote: ENTITY_TYPE.quote,
	invoice: ENTITY_TYPE.invoice,
	smartProcessItem: 'smartProcess',
};

/** Entity types that carry phones, e-mails and messengers (the `fm` multifield). */
export const MULTIFIELD_TYPES: number[] = [ENTITY_TYPE.lead, ENTITY_TYPE.contact, ENTITY_TYPE.company];

/** Options for pickers that take any CRM object type. Smart processes are typed in by ID. */
export const ENTITY_TYPE_OPTIONS = [
	{ name: 'Company', value: ENTITY_TYPE.company },
	{ name: 'Contact', value: ENTITY_TYPE.contact },
	{ name: 'Deal', value: ENTITY_TYPE.deal },
	{ name: 'Invoice', value: ENTITY_TYPE.invoice },
	{ name: 'Lead', value: ENTITY_TYPE.lead },
	{ name: 'Quote', value: ENTITY_TYPE.quote },
];

const NAMES: Record<number, [name: string, abbr: string]> = {
	1: ['LEAD', 'L'],
	2: ['DEAL', 'D'],
	3: ['CONTACT', 'C'],
	4: ['COMPANY', 'CO'],
	5: ['INVOICE', 'I'],
	7: ['QUOTE', 'Q'],
	8: ['REQUISITE', 'RQ'],
	14: ['ORDER', 'O'],
	31: ['SMART_INVOICE', 'SI'],
};

/** LEAD, DEAL, DYNAMIC_1042 — the symbolic type code older methods take. */
export function entityTypeName(entityTypeId: number): string {
	return NAMES[entityTypeId]?.[0] ?? `DYNAMIC_${entityTypeId}`;
}

/** L, D, SI, T412 — the short code product rows and CRM link fields take. Smart processes are T + hex ID. */
export function entityTypeAbbr(entityTypeId: number): string {
	return NAMES[entityTypeId]?.[1] ?? `T${entityTypeId.toString(16)}`;
}

/** The entity type of the item resource being executed. */
export function itemEntityTypeId(ctx: IExecuteFunctions, resource: string, itemIndex: number): number {
	const mapped = ITEM_RESOURCES[resource];
	if (typeof mapped === 'number') return mapped;

	const id = Number(ctx.getNodeParameter('smartProcessType', itemIndex));
	if (!Number.isInteger(id) || id < 1000) {
		throw new NodeOperationError(ctx.getNode(), 'Pick a smart process', {
			itemIndex,
			description: 'Smart process types have IDs of 1000 and above, listed by the Smart Process Type resource.',
		});
	}
	return id;
}

/** The same while the editor loads options, when no item exists yet. */
export function editorEntityTypeId(ctx: ILoadOptionsFunctions): number | undefined {
	const resource = String(ctx.getNodeParameter('resource', '') ?? '');
	const mapped = ITEM_RESOURCES[resource];
	if (typeof mapped === 'number') return mapped;

	const raw = ctx.getCurrentNodeParameter('smartProcessType') ?? ctx.getCurrentNodeParameter('entityTypeId');
	const id = Number(raw);
	return Number.isInteger(id) && id > 0 ? id : undefined;
}
