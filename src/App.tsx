import { useState } from 'react'

type Page = 'groups' | 'group' | 'expense' | 'login'

const expenses = [
  { icon: '🏡', title: 'Casa da praia', detail: 'Ana pagou · 4 pessoas', amount: 'R$ 680,00', color: 'peach' },
  { icon: '🛒', title: 'Mercado', detail: 'Você pagou · 5 pessoas', amount: 'R$ 247,35', color: 'mint' },
  { icon: '🍕', title: 'Pizza de sexta', detail: 'Rafa pagou · 5 pessoas', amount: 'R$ 126,00', color: 'lavender' },
]

function App() {
  const [page, setPage] = useState<Page>('groups')

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#inicio" onClick={(event) => { event.preventDefault(); setPage('groups') }}>
          <span className="brand-mark">s<span>.</span></span>
          <span>split<span className="brand-accent">uai</span></span>
        </a>
        <div className="side-label">MENU</div>
        <nav className="main-nav" aria-label="Navegação principal">
          <button className={page === 'groups' || page === 'group' || page === 'expense' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('groups')}>
            <span className="nav-icon">▦</span> Meus grupos
          </button>
          <button className="nav-item" onClick={() => setPage('login')}>
            <span className="nav-icon">◎</span> Minha conta
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><span className="help-icon">✳</span><strong>Dividir fica leve.</strong><p>Organize os gastos e aproveite o que importa.</p></div>
          <div className="profile"><div className="avatar avatar-you">V</div><div><strong>Você</strong><small>Conta pessoal</small></div><span className="profile-more">···</span></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar"><div className="breadcrumb">Espaço pessoal <span>/</span> <strong>{page === 'login' ? 'Minha conta' : page === 'expense' ? 'Nova despesa' : page === 'group' ? 'Fim de semana em Floripa' : 'Meus grupos'}</strong></div><button className="top-avatar" aria-label="Perfil">V</button></header>

        {page === 'groups' && <Groups onOpen={() => setPage('group')} onCreate={() => setPage('group')} />}
        {page === 'group' && <Group onBack={() => setPage('groups')} onExpense={() => setPage('expense')} />}
        {page === 'expense' && <Expense onBack={() => setPage('group')} />}
        {page === 'login' && <Login />}
      </main>
    </div>
  )
}

function Groups({ onOpen, onCreate }: { onOpen: () => void; onCreate: () => void }) {
  return <section className="page-wrap">
    <div className="eyebrow">QUARTA-FEIRA, 7 DE OUTUBRO</div>
    <div className="page-heading"><div><h1>Seus grupos<span className="heading-dot">.</span></h1><p>Todo mundo na mesma página. E na mesma conta.</p></div><button className="button button-dark" onClick={onCreate}><span>＋</span> Novo grupo</button></div>
    <div className="summary-row"><div className="summary-card summary-green"><div className="summary-label">GRUPOS ATIVOS <span>↗</span></div><strong>3</strong><small>Seu mundo compartilhado</small><div className="summary-decoration">◌</div></div><div className="summary-card"><div className="summary-label">SEU SALDO TOTAL <span>⌁</span></div><strong className="balance-value">+ R$ 184<span>,50</span></strong><small>Você tem a receber</small><div className="balance-bars"><i /><i /><i /><i /><i /></div></div><div className="tip-card"><div className="tip-spark">✳</div><div><strong>Na ponta do lápis,<br />sem o lápis.</strong><p>Adicione os gastos da galera<br />e deixe a conta com a gente.</p></div><span className="tip-art">↗</span></div></div>
    <div className="section-title"><div><h2>Em andamento</h2><p>Grupos com atividade recente</p></div><button className="text-button">Ver todos <span>→</span></button></div>
    <div className="group-grid">
      <button className="group-card featured-group" onClick={onOpen}><div className="group-cover cover-coast"><span className="cover-tag">VIAGEM</span><span className="cover-emoji">🌊</span><div className="cover-caption">FLORIPA, SC <span>·</span> OUT 2026</div></div><div className="group-card-body"><div className="group-title-line"><h3>Fim de semana em Floripa</h3><span className="arrow-circle">↗</span></div><p>Uma escapada boa dessas merece conta organizada.</p><div className="group-meta"><div className="avatar-stack"><span className="avatar av-yellow">A</span><span className="avatar av-pink">R</span><span className="avatar av-blue">M</span><span className="avatar av-gray">+2</span></div><span>5 pessoas</span><span className="meta-divider" /><span>8 despesas</span></div><div className="group-card-footer"><span>Seu saldo</span><strong className="positive">+ R$ 120,00</strong></div></div></button>
      <button className="group-card" onClick={onOpen}><div className="group-cover cover-dinner"><span className="cover-tag">DIA A DIA</span><span className="cover-emoji">🍝</span><div className="cover-caption">SÃO PAULO, SP <span>·</span> DESDE AGO 2026</div></div><div className="group-card-body"><div className="group-title-line"><h3>Apê 302</h3><span className="arrow-circle">↗</span></div><p>As contas da casa, sem conversa atravessada.</p><div className="group-meta"><div className="avatar-stack"><span className="avatar av-purple">L</span><span className="avatar av-green">C</span><span className="avatar av-orange">J</span></div><span>3 pessoas</span><span className="meta-divider" /><span>12 despesas</span></div><div className="group-card-footer"><span>Seu saldo</span><strong className="negative">− R$ 32,50</strong></div></div></button>
      <button className="new-group-card" onClick={onCreate}><span className="new-group-icon">＋</span><strong>Começar um grupo novo</strong><small>Viagem, casa, rolê... você escolhe.</small></button>
    </div>
    <footer className="page-footer"><span>Feito pra dividir a vida. <b>♡</b></span><span>SplitUai <i>·</i> 2026</span></footer>
  </section>
}

function Group({ onBack, onExpense }: { onBack: () => void; onExpense: () => void }) {
  return <section className="page-wrap"><button className="back-link" onClick={onBack}>← Voltar aos grupos</button><div className="detail-hero"><div><div className="eyebrow">VIAGEM · OUTUBRO 2026</div><h1>Fim de semana<br />em Floripa<span className="heading-dot">.</span></h1><p>Sol, mar e uma conta sem estresse.</p><div className="detail-people"><div className="avatar-stack"><span className="avatar av-yellow">A</span><span className="avatar av-pink">R</span><span className="avatar av-blue">M</span><span className="avatar av-green">V</span><span className="avatar av-gray">+1</span></div><span>5 pessoas no grupo</span></div></div><div className="detail-illustration">🌊</div></div><div className="detail-stats"><div><small>GASTOS DO GRUPO</small><strong>R$ 1.053,35</strong></div><div><small>SUA PARTE</small><strong>R$ 210,67</strong></div><div><small>SEU SALDO</small><strong className="positive">+ R$ 120,00</strong></div><button className="button button-dark" onClick={onExpense}><span>＋</span> Adicionar despesa</button></div><div className="section-title detail-section-title"><div><h2>Despesas</h2><p>O que já rolou por aqui</p></div><button className="text-button">Filtrar <span>⌄</span></button></div><div className="expense-list">{expenses.map((expense) => <div className="expense-row" key={expense.title}><span className={`expense-icon ${expense.color}`}>{expense.icon}</span><div className="expense-name"><strong>{expense.title}</strong><small>{expense.detail}</small></div><strong className="expense-amount">{expense.amount}</strong><span className="row-arrow">›</span></div>)}</div></section>
}

function Expense({ onBack }: { onBack: () => void }) {
  return <section className="page-wrap form-wrap"><button className="back-link" onClick={onBack}>← Voltar ao grupo</button><div className="eyebrow">FIM DE SEMANA EM FLORIPA</div><h1>Nova despesa<span className="heading-dot">.</span></h1><p className="form-intro">Anote aqui que a gente divide direitinho.</p><form onSubmit={(event) => { event.preventDefault(); onBack() }}><label>O que foi?<input placeholder="Ex.: almoço na praia" /></label><div className="form-two"><label>Quanto?<div className="money-input"><span>R$</span><input placeholder="0,00" inputMode="decimal" /></div></label><label>Quem pagou?<select defaultValue="you"><option value="you">Você</option><option>Ana</option><option>Rafa</option><option>Marina</option></select></label></div><label>Categoria<select defaultValue="food"><option value="food">🍴 Alimentação</option><option>🏡 Hospedagem</option><option>🚗 Transporte</option><option>🎟️ Atividades</option><option>✳ Outros</option></select></label><div className="form-note"><span>✳</span> A divisão igualitária entre as pessoas do grupo fica pronta automaticamente.</div><div className="form-actions"><button type="button" className="button button-light" onClick={onBack}>Cancelar</button><button type="submit" className="button button-dark">Salvar despesa <span>→</span></button></div></form></section>
}

function Login() {
  return <section className="page-wrap form-wrap"><div className="eyebrow">BEM-VINDE DE VOLTA</div><h1>Que bom te ver<span className="heading-dot">.</span></h1><p className="form-intro">Entre na sua conta para continuar dividindo.</p><form onSubmit={(event) => event.preventDefault()}><label>Seu e-mail<input type="email" placeholder="voce@email.com" /></label><label>Senha<input type="password" placeholder="Sua senha" /></label><button className="button button-dark full-button" type="submit">Entrar <span>→</span></button><div className="login-footnote">O SplitUai é um espaço privado. Novas contas entram por convite.</div></form></section>
}

export default App
