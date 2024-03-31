import axios from 'axios';

import { currency, FXRate } from 'src/types';

const getHSBCCNFXRates = async (): Promise<FXRate[]> => {
    const req = await axios.get(
        'https://www.services.cn-banking.hsbc.com.cn/mobile/channel/digital-proxy/cnyTransfer/ratesInfo/remittanceRate?locale=en_CN',
        {
            headers: {
                'User-Agent': 'fxrate axios/latest',
                'Content-Type': 'application/json',
            },
        },
    );

    const data = req.data.data.counterForRepeatingBlock;

    return data.map((k) => {
        return {
            currency: {
                from: 'CNY' as currency.CNY,
                to: k.exchangeRateCurrency as currency.unknown,
            },
            rate: {
                sell: {
                    cash: parseFloat(k.notesSellingRate),
                    remit: parseFloat(k.transferSellingRate),
                },
                buy: {
                    cash: parseFloat(k.notesBuyingRate),
                    remit: parseFloat(k.transferBuyingRate),
                },
            },
            unit: 1,
            updated: new Date(),
        };
    });
};

export default getHSBCCNFXRates;
