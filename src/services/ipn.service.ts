import { injectable, inject } from 'inversify';
import { getConnection } from 'typeorm';
import { PaymentGateTransaction, PAYMENT_GATE_TRANSACTION_STATUS_PENDING, PAYMENT_GATE_TRANSACTION_STATUS_FAILED, PAYMENT_GATE_TRANSACTION_STATUS_STARTED, PAYMENT_GATE_TRANSACTION_TYPE_BUY, PAYMENT_GATE_TRANSACTION_STATUS_COMPLETE, PAYMENT_GATE_TRANSACTION_STATUS_INITIATE_TRANSFER_TOKENS, PAYMENT_GATE_TRANSACTION_TYPE_CONVERT } from '../entities/payment.gate.transaction';
import { IPNResponse } from '../entities/ipn.response';
import { CoinpaymentsClient, CoinpaymentsClientType } from './coinpayments.client';
import config from '../config';

@injectable()
export class IPNService implements IPNServiceInterface {

  constructor(
    @inject(CoinpaymentsClientType) private cpClient: CoinpaymentsClientInterface
  ) { }

  async processFail(data: any): Promise<PaymentGateTransactionInterface> {
    const txRepository = getConnection().mongoManager.getMongoRepository(PaymentGateTransaction);
    const tx: PaymentGateTransaction = await txRepository.findOne({where: {
      'buyCoinpaymentsData.txn_id': data.txn_id
    }});

    if (!tx) {
      throw new Error('Transaction not found');
    }

    if ([PAYMENT_GATE_TRANSACTION_STATUS_STARTED, PAYMENT_GATE_TRANSACTION_STATUS_FAILED, PAYMENT_GATE_TRANSACTION_STATUS_PENDING].indexOf(tx.status) < 0) {
      throw new Error('Invalid status');
    }

    const ipnResponse = IPNResponse.createIPNResponse(data);

    tx.status = PAYMENT_GATE_TRANSACTION_STATUS_FAILED;
    if (tx.type === PAYMENT_GATE_TRANSACTION_TYPE_BUY) {
      tx.buyIpns.push({...ipnResponse, timestamp: Date.now()});
    } else {
      tx.convertIpns.push({...ipnResponse, timestamp: Date.now()});
    }

    return getConnection().mongoManager.save(tx);
  }

  async processPending(data: any): Promise<PaymentGateTransactionInterface> {
    const txRepository = getConnection().mongoManager.getMongoRepository(PaymentGateTransaction);
    const tx: PaymentGateTransaction = await txRepository.findOne({where: {
      'buyCoinpaymentsData.txn_id': data.txn_id
    }});

    if (!tx) {
      throw new Error('Transaction not found');
    }

    if ([PAYMENT_GATE_TRANSACTION_STATUS_STARTED, PAYMENT_GATE_TRANSACTION_STATUS_PENDING].indexOf(tx.status) < 0) {
      throw Error('Invalid status');
    }

    const ipnResponse = IPNResponse.createIPNResponse(data);

    tx.status = PAYMENT_GATE_TRANSACTION_STATUS_PENDING;
    if (tx.type === PAYMENT_GATE_TRANSACTION_TYPE_BUY) {
      tx.buyIpns.push({...ipnResponse, timestamp: Date.now()});
    } else {
      tx.convertIpns.push({...ipnResponse, timestamp: Date.now()});
    }

    return getConnection().mongoManager.save(tx);
  }

  async processComplete(data: any): Promise<PaymentGateTransactionInterface> {
    const txRepository = getConnection().mongoManager.getMongoRepository(PaymentGateTransaction);
    const tx: PaymentGateTransaction = await txRepository.findOne({where: {
      'buyCoinpaymentsData.txn_id': data.txn_id
    }});

    if (!tx) {
      throw new Error('Transaction not found');
    }

    if ([PAYMENT_GATE_TRANSACTION_STATUS_STARTED, PAYMENT_GATE_TRANSACTION_STATUS_PENDING, PAYMENT_GATE_TRANSACTION_STATUS_INITIATE_TRANSFER_TOKENS].indexOf(tx.status) < 0) {
      throw Error('Invalid status');
    }

    const ipnResponse = IPNResponse.createIPNResponse(data);
    tx.status = PAYMENT_GATE_TRANSACTION_STATUS_COMPLETE;
    if (tx.type === PAYMENT_GATE_TRANSACTION_TYPE_BUY) {
      tx.buyIpns.push({...ipnResponse, timestamp: Date.now()});
    } else {
      tx.convertIpns.push({...ipnResponse, timestamp: Date.now()});
    }

    if (tx.type !== PAYMENT_GATE_TRANSACTION_TYPE_BUY) {
      return;
    }

    tx.type = PAYMENT_GATE_TRANSACTION_TYPE_CONVERT;
    tx.status = PAYMENT_GATE_TRANSACTION_STATUS_STARTED;
    getConnection().mongoManager.save(tx);

    tx.convertCoinpaymentsData = await this.cpClient.convertCoinsTransaction({
      amount: tx.buyCoinpaymentsData.amount,
      from: tx.buyCoinpaymentsData.currency2,
      to: config.coinPayments.currency1,
      address: tx.user.ethWallet.address
    });

    tx.status = PAYMENT_GATE_TRANSACTION_STATUS_PENDING;

    return getConnection().mongoManager.save(tx);
  }
}

const IPNServiceType = Symbol('IPNServiceInterface');
export { IPNServiceType };
