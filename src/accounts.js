// Hệ thống tài khoản TT133 dùng trong phần mềm (rút gọn cho công ty thi công nhỏ).
export const ACCOUNTS = {
  '111': 'Tiền mặt',
  '112': 'Tiền gửi ngân hàng',
  '131': 'Phải thu của khách hàng',
  '1331': 'Thuế GTGT được khấu trừ',
  '141': 'Tạm ứng',
  '152': 'Nguyên liệu, vật liệu',
  '154': 'Chi phí SXKD dở dang (theo công trình)',
  '211': 'Tài sản cố định',
  '214': 'Hao mòn TSCĐ',
  '242': 'Chi phí trả trước',
  '331': 'Phải trả cho người bán',
  '3331': 'Thuế GTGT phải nộp',
  '33311': 'Thuế GTGT đầu ra',
  '3334': 'Thuế TNDN',
  '3335': 'Thuế TNCN',
  '3338': 'Thuế khác, phí, lệ phí',
  '334': 'Phải trả người lao động',
  '338': 'Phải trả, phải nộp khác (BHXH…)',
  '341': 'Vay và nợ thuê tài chính',
  '4111': 'Vốn góp của chủ sở hữu',
  '421': 'Lợi nhuận sau thuế chưa phân phối',
  '511': 'Doanh thu bán hàng, cung cấp dịch vụ',
  '515': 'Doanh thu hoạt động tài chính',
  '632': 'Giá vốn hàng bán',
  '635': 'Chi phí tài chính (lãi vay…)',
  '6422': 'Chi phí quản lý doanh nghiệp',
  '711': 'Thu nhập khác',
  '811': 'Chi phí khác',
  '821': 'Chi phí thuế TNDN',
  '911': 'Xác định kết quả kinh doanh',
};

// Bút toán khác (nhập tay): KHÔNG cho dùng 154/511/632/131/331 theo công trình… để mọi số liệu công trình đi qua chứng từ công trình.
// 131/331 được dùng (vd bù trừ công nợ, số dư đầu kỳ) nhưng không gắn công trình.
export const MANUAL_ACCOUNTS = ['111', '112', '131', '1331', '141', '152', '211', '214', '242', '331', '3331', '3334', '3335', '3338',
  '334', '338', '341', '4111', '421', '515', '635', '6422', '711', '811', '821'];
// Số dư đầu kỳ: chỉ tài khoản bảng cân đối.
export const OPENING_ACCOUNTS = ['111', '112', '131', '1331', '141', '152', '211', '214', '242', '331', '3331', '3334', '3335', '3338',
  '334', '338', '341', '4111', '421'];
export const PL_INCOME = ['515', '711'];
export const PL_EXPENSE = ['635', '811'];

// Loại chứng từ của khoản chi — xử lý chi phí KHÔNG có hoá đơn GTGT.
export const EVIDENCE = {
  hoa_don_gtgt: 'Hoá đơn GTGT',
  hoa_don_ban_hang: 'Hoá đơn bán hàng (không có thuế GTGT)',
  bang_ke: 'Mua của cá nhân/hộ không có hoá đơn → Bảng kê 01/TNDN',
  nhan_cong_khoan: 'Thuê khoán nhân công cá nhân (hợp đồng + khấu trừ TNCN)',
  noi_bo: 'Chứng từ nội bộ (bảng lương, phiếu chi, biên nhận)',
  khong_hop_le: 'Không có chứng từ hợp lệ (không được trừ khi tính thuế)',
};
