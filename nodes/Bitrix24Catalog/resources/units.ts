import type { Resource } from '../../../shared/spec';
import { catalogCrud } from '../shared/helpers';

export const measureResource: Resource = {
	value: 'measure',
	name: 'Unit of Measure',
	description: 'Units products are counted in: pieces, kilograms, meters',
	operations: catalogCrud({
		prefix: 'catalog.measure',
		key: 'measure',
		noun: 'unit of measure',
		plural: 'units of measure',
		fieldsExample: '{"code": 778, "measureTitle": "Pack", "symbol": "pk", "symbolIntl": "pk", "symbolLetterIntl": "PK", "isDefault": "N"}',
		descriptions: { create: 'Add a unit of measure; code and measureTitle are required, and the code must be unique' },
	}),
};

export const vatRateResource: Resource = {
	value: 'vatRate',
	name: 'VAT Rate',
	description: 'VAT rates products can be sold with',
	operations: catalogCrud({
		prefix: 'catalog.vat',
		key: 'vat',
		noun: 'VAT rate',
		plural: 'VAT rates',
		fieldsExample: '{"name": "VAT 10%", "rate": 10, "active": "Y", "sort": 200}',
		descriptions: { update: 'Change a VAT rate. Bitrix24 wants name on every update, even when it stays the same.' },
	}),
};

export const unitRatioResource: Resource = {
	value: 'unitRatio',
	name: 'Unit Ratio',
	description: 'How many units a product is sold by at once, e.g. packs of 6',
	operations: catalogCrud({
		prefix: 'catalog.ratio',
		key: 'ratio',
		noun: 'unit ratio',
		plural: 'unit ratios',
		kinds: ['get', 'getMany', 'getFields'],
		fieldsExample: '{}',
		descriptions: { getMany: 'Read unit ratios, e.g. of one product with the filter {"productId": 101}' },
	}),
};
