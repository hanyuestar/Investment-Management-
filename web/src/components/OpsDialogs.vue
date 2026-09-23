<template>
  <AssetDialog v-model="assetDlg" :asset="editingAsset" :accounts="store.accounts" @saved="changed" />
  <EventDialog v-if="eventAsset" v-model="eventDlg" :asset="eventAsset" :event="editingEvent" @saved="changed" />
  <AlertDialog v-if="alertAsset" v-model="alertDlg" :asset="alertAsset" @saved="changed" />
  <AccountDialog v-model="accountDlg" :account="editingAccount" @saved="changed" />
  <CashFlowDialog v-model="cashDlg" :accounts="store.accounts" :default-account-id="defaultCashAccount" @saved="changed" />
  <DcaPlanDialog v-model="dcaDlg" :assets="store.assets" @saved="changed" />
  <FxDialog v-model="fxDlg" @saved="changed" />
</template>

<script setup>
import { ref } from 'vue';
import AssetDialog from './AssetDialog.vue';
import EventDialog from './EventDialog.vue';
import AlertDialog from './AlertDialog.vue';
import AccountDialog from './AccountDialog.vue';
import CashFlowDialog from './CashFlowDialog.vue';
import DcaPlanDialog from './DcaPlanDialog.vue';
import FxDialog from './FxDialog.vue';
import { usePortfolioStore } from '../stores/portfolio';

const store = usePortfolioStore();
const emit = defineEmits(['changed']);

const assetDlg = ref(false);
const eventDlg = ref(false);
const alertDlg = ref(false);
const accountDlg = ref(false);
const cashDlg = ref(false);
const dcaDlg = ref(false);
const fxDlg = ref(false);

const editingAsset = ref(null);
const eventAsset = ref(null);
const editingEvent = ref(null);
const alertAsset = ref(null);
const editingAccount = ref(null);
const defaultCashAccount = ref('');

async function changed() {
  await store.refreshAll();
  emit('changed');
}

defineExpose({
  createAsset: () => { editingAsset.value = null; assetDlg.value = true; },
  editAsset: (a) => { editingAsset.value = a; assetDlg.value = true; },
  addEvent: (a) => { eventAsset.value = a; editingEvent.value = null; eventDlg.value = true; },
  editEvent: (a, e) => { eventAsset.value = a; editingEvent.value = e; eventDlg.value = true; },
  setAlert: (a) => { alertAsset.value = a; alertDlg.value = true; },
  createAccount: () => { editingAccount.value = null; accountDlg.value = true; },
  editAccount: (a) => { editingAccount.value = a; accountDlg.value = true; },
  addCash: (accountId = '') => { defaultCashAccount.value = accountId; cashDlg.value = true; },
  createDca: () => { dcaDlg.value = true; },
  addFx: () => { fxDlg.value = true; },
});
</script>
