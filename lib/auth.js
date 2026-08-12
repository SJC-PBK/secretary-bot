// [접근 통제] 허용된 Slack 사용자만 봇을 쓸 수 있게 판별

function isAllowed(userId) {
  return !!userId && userId === process.env.ALLOWED_SLACK_USER_ID;
}

module.exports = { isAllowed };
