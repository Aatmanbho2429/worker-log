/**
 * Every Tauri command name, named once so a typo becomes a compile error
 * rather than a rejected promise at runtime.
 *
 * Mirrors the `#[tauri::command]` functions registered in
 * `src-tauri/src/lib.rs`'s `tauri::generate_handler![...]` list — snake_case,
 * `entity_action`. See `.claude/rules/tauri-ipc.md`.
 */
export const TAURI_COMMANDS = {
  appInfo: 'app_info',
  deviceId: 'device_id',

  // ------------------------------------------------------------- series ---
  listSeries: 'list_series',
  createSeries: 'create_series',
  updateSeries: 'update_series',
  deleteSeries: 'delete_series',

  // ------------------------------------------------------------ reasons ---
  listReasons: 'list_reasons',
  createReason: 'create_reason',
  updateReason: 'update_reason',
  deleteReason: 'delete_reason',

  // ------------------------------------------------------------- grades ---
  listGrades: 'list_grades',
  createGrade: 'create_grade',
  updateGrade: 'update_grade',
  gradeDeleteImpact: 'grade_delete_impact',
  deleteGrade: 'delete_grade',

  // ------------------------------------------------------------ workers ---
  listWorkers: 'list_workers',
  createWorker: 'create_worker',
  updateWorker: 'update_worker',
  workerDeleteImpact: 'worker_delete_impact',
  deleteWorker: 'delete_worker',

  // -------------------------------------------------------------- waste ---
  wasteDashboard: 'waste_dashboard',
  wasteLogs: 'waste_logs',
  addWasteEntry: 'add_waste_entry',
  undoWasteEntry: 'undo_waste_entry',

  // ------------------------------------------------------------ exports ---
  exportWastePdf: 'export_waste_pdf',
  exportWasteCsv: 'export_waste_csv',
  exportBarcodesPdf: 'export_barcodes_pdf',

  // --------------------------------------------------------------- demo ---
  seedDemoData: 'seed_demo_data',

  // ------------------------------------------------------------ barcodes ---
  barcodeSheet: 'barcode_sheet',
  recordScan: 'record_scan',

  // ----------------------------------------------------------------- auth ---
  authRegister: 'auth_register',
  authLogin: 'auth_login',
  authRestore: 'auth_restore',
  authValidate: 'auth_validate',
  authLogout: 'auth_logout',
  authSendOtp: 'auth_send_otp',
  authForgotPassword: 'auth_forgot_password',
  authChangePassword: 'auth_change_password',
  authPayments: 'auth_payments',
  authPlans: 'auth_plans',
  authCreateOrder: 'auth_create_order',
  authVerifyPayment: 'auth_verify_payment',
} as const;
