import nodemailer from "nodemailer";

const host = process.env.SMTP_HOST ?? "localhost";
const port = Number(process.env.SMTP_PORT ?? 1025);
const secure = process.env.SMTP_SECURE === "true";
const from = process.env.EMAIL_FROM ?? "PBP Server <no-reply@localhost>";
const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    ...(process.env.SMTP_USER && process.env.SMTP_PASSWORD
        ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } }
        : {}),
});

export async function sendVerificationOtpEmail(email: string, otp: string, type: string) {
    const purpose =
        type === "email-verification"
            ? "verifikasi alamat email"
            : type === "forget-password"
              ? "mengatur ulang kata sandi"
              : "masuk ke akun";
    await transporter.sendMail({
        from,
        to: email,
        subject: `Kode OTP Ngumpul untuk ${purpose}`,
        text: `Kode OTP Anda untuk ${purpose} adalah ${otp}. Kode berlaku selama 10 menit. Jangan bagikan kode ini kepada siapa pun.`,
        html: `<p>Kode OTP Anda untuk ${purpose}:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${otp}</p><p>Kode berlaku selama 10 menit. Jangan bagikan kode ini kepada siapa pun.</p>`,
    });
}
