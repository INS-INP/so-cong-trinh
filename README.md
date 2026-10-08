# Sổ Công Trình

Phần mềm kế toán và bóc tách chi phí cho công ty thi công. Chạy trên Cloudflare Workers, **độc lập hoàn toàn**: dữ liệu riêng (SQLite trong Durable Object), không dùng chung mã nguồn hay dữ liệu với hệ thống nào khác.

## Làm được gì
- **Công trình**: mã, khách, giá trị hợp đồng; theo dõi doanh thu, chi phí, lãi gộp, % lãi, còn phải thu.
- **Chi phí bóc tách theo công trình**: vật tư lấy của INSOLAR, vật tư mua ngoài, nhân công, thuê máy, vận chuyển, chi phí khác. Chi phí chung (lương quản lý, văn phòng, xăng xe…) ghi riêng.
- **Bắt buộc chứng từ**: mỗi khoản chi phải có ảnh/PDF (chụp bằng điện thoại, tự nén).
- **Nhập hoá đơn điện tử XML** (chuẩn TT78): tự đọc nhà cung cấp, số hoá đơn, tiền hàng, thuế, từng dòng hàng; tự nhận INSOLAR theo MST; không nhập trùng; từ chối hoá đơn xuất cho MST khác.
- **Duyệt**: khoản do chỉ huy nhập và khoản lớn hơn ngưỡng phải có **người khác** duyệt (kế toán, quản trị hoặc cổ đông).
- **Không xoá**: huỷ bằng bút toán đảo (số âm), giữ nguyên chứng từ gốc.
- **Khoá sổ tháng**: lưu ảnh chụp số liệu + mã kiểm tra. Sau khi khoá không ai thêm/sửa được tháng đó; phần mềm tự kiểm tra số liệu gốc có bị thay đổi không.
- **Ký xác nhận**: cổ đông ký số liệu tháng đã khoá ngay trên phần mềm.
- **Báo cáo tháng**: lãi gộp công trình nghiệm thu, điều chỉnh sau nghiệm thu, chi phí chung, dự phòng bảo hành, **lãi ròng và phần chia theo tỷ lệ cổ phần**; phân bổ chi phí chung cho từng công trình.
- **Sổ nhật ký chung TT133** tự sinh: chi phí công trình Nợ 154, chi phí chung Nợ 6422, nghiệm thu kết chuyển 154 → 632, doanh thu Nợ 131 / Có 511, 33311, thu tiền, trả NCC.
- **Công nợ**: phải trả từng NCC, phải thu từng công trình, **bảng đối chiếu với INSOLAR theo tháng** (so số với INSOLAR mà không nối hai hệ thống).
- **Chi phí không có hoá đơn** — chọn "Loại chứng từ" khi nhập:
  - *Mua của cá nhân/hộ không có hoá đơn* (cát, đá, vật liệu lẻ): chụp biên nhận có họ tên, địa chỉ, chữ ký người bán → tự lên **Bảng kê 01/TNDN** (xuất Excel ở mục Thuế), vẫn được tính chi phí.
  - *Thuê khoán nhân công cá nhân*: chụp hợp đồng khoán + biên nhận + CCCD → lần trả từ 2 triệu **tự khấu trừ 10% thuế TNCN** (Có 3335), trừ khi có cam kết 08/CK-TNCN; có danh sách để kê khai.
  - *Chứng từ nội bộ* (bảng lương, phiếu chi) và *Không có chứng từ hợp lệ* (vẫn ghi để quản lý tiền nhưng đánh dấu **không được trừ** khi tính thuế TNDN).
  - Hoá đơn từ 5 triệu trả **tiền mặt** → cảnh báo thuế GTGT đầu vào không được khấu trừ.
- **Tạm ứng (TK 141)**: cấp tiền cho chỉ huy, chỉ huy nhập chi phí "trả bằng tiền tạm ứng", hoàn ứng tiền thừa; xem số dư từng người.
- **Dự toán công trình** theo từng khoản mục: so thực tế, % đã dùng, cảnh báo vượt, lãi gộp dự kiến.
- **Bút toán khác & số dư đầu kỳ**: góp vốn, vay, lương văn phòng, nộp thuế, rút tiền… (không cho dùng TK công trình 154/511/632); phải cân Nợ = Có; huỷ bằng bút toán đảo.
- **Bảng cân đối số phát sinh, sổ cái từng tài khoản, sổ quỹ tiền mặt (111), sổ tiền gửi (112)**.
- **Thuế & bảng kê**: GTGT đầu ra/đầu vào/phải nộp tạm tính, Bảng kê 01/TNDN, TNCN đã khấu trừ, chi phí không được trừ.
- **Nhật ký thao tác**: ai làm gì, lúc nào, trước/sau.
- Xuất Excel (CSV), in/PDF báo cáo. Dùng tốt trên điện thoại.
- **Cài như ứng dụng (PWA)**: menu "Cài ứng dụng lên máy" hướng dẫn cho iPhone (Safari → Chia sẻ → Thêm vào MH chính), Android và máy tính. Khoá phóng to khi dùng trên điện thoại.

## Nhiều người, nhiều máy dùng cùng lúc
- Mỗi người một tài khoản riêng (cổ đông, kế toán, chỉ huy…), tạo ở **Cài đặt & người dùng**. Một tài khoản đăng nhập được nhiều máy; xem và đăng xuất máy khác ở **Mật khẩu & máy đăng nhập**.
- Dữ liệu lưu theo **từng dòng chứng từ** trong 1 cơ sở dữ liệu duy nhất xử lý tuần tự, nên hai người lưu cùng lúc không bao giờ đè dữ liệu của nhau.
- **Chống gửi trùng**: mỗi lần bấm lưu mang 1 mã riêng; bấm nhiều lần, mạng chập chờn gửi lại hay 2 máy gửi cùng lúc thì chỉ ghi 1 lần.
- **Chống ghi đè**: sửa khoản chi, công trình, dự toán, đối tác, người dùng, cài đặt đều kèm số phiên bản; nếu người khác vừa sửa trước thì từ chối và tải lại bản mới.
- **Chống nhập trùng chứng từ**: cùng nhà cung cấp + cùng số hoá đơn bị chặn; khoản giống hệt vừa nhập trong 30 phút thì hỏi lại.
- **Tự cập nhật**: 20 giây kiểm tra 1 lần, ai vừa ghi gì thì màn hình người khác tự tải lại (không làm mất form đang nhập dở).

## Vai trò
| Vai trò | Quyền |
|---|---|
| Quản trị | Toàn quyền, người dùng, cài đặt, tỷ lệ cổ phần |
| Kế toán | Nhập/duyệt chi phí, doanh thu, thu tiền, trả NCC, nghiệm thu, khoá sổ |
| Chỉ huy công trình | Chỉ nhập chi phí công trình kèm chứng từ, chỉ thấy khoản mình nhập, mọi khoản đều chờ duyệt |
| Cổ đông | Xem toàn bộ, duyệt khoản chi, ký xác nhận báo cáo tháng; không sửa được số liệu |

## Đưa lên mạng (một lần, khoảng 3 phút)
1. Vào https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Import a repository**.
2. Chọn kho GitHub `so-cong-trinh` → để nguyên cài đặt (lệnh deploy `npx wrangler deploy`) → **Deploy**.
3. Mở địa chỉ `https://so-cong-trinh.<tài-khoản>.workers.dev` → màn hình **Thiết lập lần đầu**: nhập tên công ty, MST, cổ đông + tỷ lệ, tài khoản Quản trị.
4. (Tuỳ chọn) Gắn tên miền riêng: Worker `so-cong-trinh` → **Settings → Domains & Routes → Add → Custom domain**.

Từ đó mỗi lần đẩy mã lên nhánh `main`, Cloudflare tự cập nhật. Dữ liệu nằm trong Durable Object `SoCongTrinh`, không mất khi cập nhật mã.

**Sao lưu**: cuối mỗi tháng, sau khi khoá sổ, xuất CSV báo cáo, chi phí, công trình, sổ nhật ký và lưu lại.

**Chuyển sang tài khoản Cloudflare/GitHub khác** (ví dụ đứng tên công ty thi công): chuyển kho GitHub (Settings → Transfer) rồi làm lại 4 bước trên ở tài khoản mới **trước khi** bắt đầu nhập liệu thật.

## Quy tắc kế toán
- Chế độ TT133/2016/TT-BTC. Tiền làm tròn đồng.
- Lãi/lỗ công trình ghi nhận vào **tháng nghiệm thu** (kết chuyển toàn bộ TK 154 sang 632). Chi phí/doanh thu phát sinh sau nghiệm thu được tính là "điều chỉnh sau nghiệm thu" của tháng phát sinh.
- Chi phí chung và dự phòng bảo hành trừ vào lãi của tháng; phân bổ cho công trình nghiệm thu trong tháng theo tỷ lệ doanh thu (chỉ để xem).
- Lãi ròng và phần chia cổ đông là số **quản trị**. Chia lợi nhuận thực tế theo quyết định của công ty sau quyết toán thuế.

## Phát triển
- `npm test` — kiểm thử toàn bộ API trên SQLite của Node (không cần Cloudflare).
- `node --no-warnings scripts/dev-server.mjs` — chạy thử trên máy tại http://localhost:8788.
- Mã: `src/app.js` (API), `src/report.js` (báo cáo, sổ nhật ký), `src/schema.js` (cấu trúc dữ liệu, chỉ thêm migration mới), `public/` (giao diện), `public/einvoice.js` (đọc hoá đơn XML, dùng chung trình duyệt/máy chủ).
