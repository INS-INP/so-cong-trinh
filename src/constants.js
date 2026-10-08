// Danh mục dùng chung cho máy chủ và giao diện.
export const ROLES = {
  quan_tri: 'Quản trị',
  ke_toan: 'Kế toán',
  chi_huy: 'Chỉ huy công trình',
  co_dong: 'Cổ đông (chỉ xem, duyệt, ký)',
};

// Chi phí gắn công trình → TK 154 (chi tiết theo mã công trình).
export const PROJECT_CATEGORIES = {
  vat_tu_insolar: 'Vật tư lấy của INSOLAR',
  vat_tu_ngoai: 'Vật tư mua ngoài',
  nhan_cong: 'Nhân công',
  may_thue: 'Thuê máy, cẩu, thiết bị',
  van_chuyen: 'Vận chuyển',
  chi_phi_khac: 'Chi phí khác của công trình',
};
// Chi phí chung (không gắn công trình) → TK 6422 (chi phí quản lý doanh nghiệp, TT133).
export const OVERHEAD_CATEGORIES = {
  chung_luong: 'Lương quản lý, văn phòng',
  chung_van_phong: 'Văn phòng, điện nước, thuê nhà',
  chung_xang_xe: 'Xăng xe, đi lại',
  chung_khac: 'Chi phí chung khác',
};
export const CATEGORIES = { ...PROJECT_CATEGORIES, ...OVERHEAD_CATEGORIES };

export const PAY_METHODS = { tien_mat: 'Tiền mặt', chuyen_khoan: 'Chuyển khoản', cong_no: 'Công nợ (chưa trả)' };
export const CASH_METHODS = { tien_mat: 'Tiền mặt', chuyen_khoan: 'Chuyển khoản' };
export const PAY_ACCOUNT = { tien_mat: '111', chuyen_khoan: '112', cong_no: '331' };

export const PROJECT_STATUS = {
  dang_thi_cong: 'Đang thi công',
  tam_dung: 'Tạm dừng',
  da_nghiem_thu: 'Đã nghiệm thu',
  huy: 'Huỷ',
};
export const COST_STATUS = { cho_duyet: 'Chờ duyệt', da_duyet: 'Đã ghi sổ', tu_choi: 'Từ chối' };
export const PARTNER_KIND = { ncc: 'Nhà cung cấp', khach: 'Khách hàng', ca_hai: 'NCC & khách' };

export const DEFAULT_SETTINGS = {
  company_name: '',
  company_mst: '',
  company_address: '',
  insolar_mst: '2803123637',
  insolar_name: 'CÔNG TY TNHH NĂNG LƯỢNG XANH INSOLAR VIỆT NAM',
  approval_threshold: '20000000',
  warranty_pct: '0',
  locked_through: '',
};
