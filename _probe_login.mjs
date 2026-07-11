const urls = [
  'https://gpt-hubli-final-e0fkseoyy-contactgpthubli-3207s-projects.vercel.app',
  'https://gpt-hubli-final.vercel.app',
]

const attempts = [
  { email: 'akshay', password: 'Zaq1Zaq2$123' },
  { email: 'akshay@gpthubli.ac.in', password: 'Zaq1Zaq2$123' },
  { email: 'admin', password: 'admin123' },
  { email: 'admin@gpthubli.ac.in', password: 'Admin@123' },
  { email: '171CS15003', password: 'Test@123' },
  { email: '171CS15003', password: 'demo1234' },
  { email: 'GP2023CSE041', password: 'demo1234' },
  { email: 'demo.student@gpthubli.ac.in', password: 'demo1234' },
]

for (const base of urls) {
  console.log('\n====', base)
  for (const body of attempts) {
    try {
      const res = await fetch(base + '/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const text = await res.text()
      console.log(res.status, body.email, text.slice(0, 200))
    } catch (e) {
      console.log('ERR', body.email, e.message)
    }
  }
  try {
    const me = await fetch(base + '/api/auth/me')
    console.log('me', me.status, await me.text())
  } catch (e) {
    console.log('me err', e.message)
  }
}
