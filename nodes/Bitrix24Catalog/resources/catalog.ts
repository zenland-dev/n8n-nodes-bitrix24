import { positiveInt } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { catalogCrud } from '../shared/helpers';

export const catalogResource: Resource = {
	value: 'catalog',
	name: 'Catalog',
	description: 'The trade catalogs of the portal: the product catalog and the one its variations live in',
	operations: [
		...catalogCrud({
			prefix: 'catalog.catalog',
			key: 'catalog',
			noun: 'catalog',
			plural: 'catalogs',
			kinds: ['get', 'getMany', 'getFields'],
			fieldsExample: '{}',
			descriptions: {
				getMany: 'List the trade catalogs. A catalog whose productIblockId is set holds the variations of that product catalog.',
			},
		}),
		{
			value: 'isVariations',
			name: 'Is Variations Catalog',
			action: 'Check whether a catalog holds variations',
			description: 'Tell whether a catalog is the one variations live in',
			properties: [
				{ displayName: 'Catalog ID', name: 'objectId', type: 'number', required: true, default: 0, description: 'ID of the catalog' },
			],
			async execute(itemIndex) {
				const id = positiveInt(this, 'objectId', itemIndex, 'Catalog ID');
				const body = await bitrix24Request.call(this, 'catalog.catalog.isOffers', { id }, { itemIndex });
				return { id, isVariations: body.result === true };
			},
		},
	],
};
