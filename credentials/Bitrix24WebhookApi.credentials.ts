import type { Icon, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

import {
	pinnedHttpRequestDomains,
	portalAddressProperties,
	portalHostExpression,
	requestsPerSecondProperty,
	webhookTokenExpression,
} from './portalAddress';

const TEST_HOST = portalHostExpression('$credentials.subdomain', '$credentials.domain');
const TEST_TOKEN = webhookTokenExpression('$credentials.webhookToken');

export class Bitrix24WebhookApi implements ICredentialType {
	name = 'bitrix24WebhookApi';

	displayName = 'Bitrix24 Webhook API';

	documentationUrl = 'https://apidocs.bitrix24.com/local-integrations/local-webhooks.html';

	icon: Icon = {
		light: 'file:../icons/bitrix24.svg',
		dark: 'file:../icons/bitrix24.dark.svg',
	};

	properties: INodeProperties[] = [
		{
			displayName:
				'Create the webhook in Bitrix24 under Developer resources → Other → Inbound webhook, tick every permission the workflows need, and copy the part of its URL after /rest/ into Webhook Token. The webhook acts as the user who created it, with that user\'s access rights.',
			name: 'setupNotice',
			type: 'notice',
			default: '',
		},
		...portalAddressProperties,
		{
			displayName: 'Webhook Token',
			name: 'webhookToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			placeholder: '1/abcdef0123456789',
			description:
				'User ID and secret code from the inbound webhook URL, as <ID>/<code>. Pasting the whole URL works too: only the part after /rest/ is kept, and the host in it is ignored in favour of the portal fields above.',
		},
		requestsPerSecondProperty,
		pinnedHttpRequestDomains,
	];

	test: ICredentialTestRequest = {
		request: {
			baseURL: `=https://{{ ${TEST_HOST} }}/rest/{{ ${TEST_TOKEN} }}`,
			url: '/profile.json',
			method: 'POST',
		},
	};
}
