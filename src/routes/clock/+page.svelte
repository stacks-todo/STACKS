<script lang="ts">
	import { onMount } from 'svelte';
	import { pendingTasks, countColor } from '$lib/localTasks';
	import { pomodoroPhase, pomodoroTimeDisplay } from '$lib/pomodoroStore';
	import { currentLocale } from '$lib/languageStore';
	import { t } from '$lib/i18n';
	import gsap from 'gsap';
	import { usePageAnimation } from '$lib/usePageAnimation';
	import { EASE_OUT, EASE_IN } from '$lib/easings';

	let now = $state(new Date());
	let frameId: number | undefined;
	let clockOuter: HTMLDivElement | undefined = $state();
	let numsWrap: HTMLDivElement | undefined = $state();
	let handsWrapEl: HTMLDivElement | undefined = $state();
	let clockWrap: HTMLDivElement | undefined = $state();
	let centerCircleEl: HTMLDivElement | undefined = $state();
	let taskCountEl: HTMLDivElement | undefined = $state();

	onMount(() => {
		const tick = () => {
			now = new Date();
			frameId = requestAnimationFrame(tick);
		};
		frameId = requestAnimationFrame(tick);
		return () => {
			if (frameId !== undefined) cancelAnimationFrame(frameId);
		};
	});

	usePageAnimation({
		animateIn(from) {
			if (from === '/table') {
				const tl = gsap.timeline();
				if (numsWrap) tl.from(numsWrap, { scale: 2, duration: 0.4, ease: EASE_OUT }, 0);
				if (handsWrapEl) tl.from(handsWrapEl, { scale: 1.6, duration: 0.3, ease: EASE_OUT }, 0);
				// width ではなく scale で拡縮（毎フレームの reflow を避ける）
				if (centerCircleEl) tl.from(centerCircleEl, { scale: 720 / centerCircleEl.offsetWidth, duration: 0.4, ease: EASE_OUT }, 0);
				if (clockWrap) tl.from(clockWrap, { opacity: 0, duration: 0.4, ease: EASE_OUT }, 0);
				if (taskCountEl) tl.from(taskCountEl, { scale: 0.9, y: -20, duration: 0.4, ease: EASE_OUT }, 0);
			} else if (from === '/pomodoro' || from === '/stack') {
				const lr = from === '/pomodoro';
				const tl = gsap.timeline();
				if (numsWrap) tl.from(numsWrap, { transform: `translate(${lr ? '50' : '-50'}%)`, duration: 0.4, ease: EASE_OUT }, 0);
				if (handsWrapEl) tl.from(handsWrapEl, { transform: `translate(${lr ? '50' : '-50'}%)`, duration: 0.4, ease: EASE_OUT }, 0);
				if (clockWrap) tl.from(clockWrap, { transform: `translate(${lr ? '50' : '-50'}%)`, duration: 0.4, ease: EASE_OUT }, 0);
				if (taskCountEl) tl.from(taskCountEl, { transform: 'translateY(130px) scale(1)', duration: 0.4, ease: EASE_OUT }, 0);
			}
		},

		animateOut(to, done) {
			if (to === '/table') {
				// done() を 0.3s で先行発火させ、ナビゲーション処理をアニメーション末尾と重ねてフリーズを隠す
				const tl = gsap.timeline();
				if (numsWrap) tl.to(numsWrap, { scale: 2, duration: 0.4, ease: EASE_IN, stagger: { amount: 0.14, from: 'random' } }, 0);
				if (handsWrapEl) tl.to(handsWrapEl, { scale: 1.8, duration: 0.3, ease: EASE_IN }, 0);
				// width ではなく scale で拡縮（毎フレームの reflow を避ける）
				if (centerCircleEl) tl.to(centerCircleEl, { scale: 720 / centerCircleEl.offsetWidth, duration: 0.4, ease: EASE_IN }, 0);
				if (clockWrap) tl.to(clockWrap, { opacity: 0, duration: 0.4, ease: EASE_IN }, 0);
				if (taskCountEl) tl.to(taskCountEl, { scale: 0.3, y: -200, duration: 0.4, ease: EASE_IN }, 0);
				tl.call(done, [], 0.3);
				return;
			}
			const tl = gsap.timeline({ onComplete: done });
			// /pomodoro, /stack, /settings
			const lr = to === '/pomodoro';
			if (numsWrap) tl.to(numsWrap, { transform: `translateX(${lr ? '50' : '-50'}%)`, duration: 0.2, ease: EASE_IN }, 0);
			if (handsWrapEl) tl.to(handsWrapEl, { transform: `translateX(${lr ? '50' : '-50'}%)`, duration: 0.2, ease: EASE_IN }, 0);
			if (clockWrap) tl.to(clockWrap, { transform: `translateX(${lr ? '50' : '-50'}%)`, duration: 0.2, ease: EASE_IN }, 0);
			if (taskCountEl) tl.to(taskCountEl, { transform: 'translateY(100px)', scale: 0.9, duration: 0.2, ease: EASE_IN }, 0);
		}
	});

	const h = $derived(now.getHours());
	const m = $derived(now.getMinutes());
	const s = $derived(now.getSeconds());
	const ms = $derived(now.getMilliseconds());
	const mo = $derived(now.getMonth() + 1);
	const d = $derived(now.getDate());
	const wd = $derived(now.getDay());
	const h12 = $derived(h % 12 || 12);
	const hh = $derived(String(h).padStart(2, '0'));
	const mm = $derived(String(m).padStart(2, '0'));

	const secondDeg = $derived(((s + ms / 1000) / 60) * 360);
	const minuteDeg = $derived(((m + s / 60 + ms / 60000) / 60) * 360);
	const hourDeg = $derived((((h % 12) + m / 60 + s / 3600) / 12) * 360);
	const numerals = Array.from({ length: 12 }, (_, i) => i + 1);
	const ui = $derived(t($currentLocale));
	const _dateStr = $derived(`${mo}月${d}日 (${ui.weekdays[wd]})`);
	const dateStrLocalized = $derived(ui.formatArcDate(now));
</script>

<div class="rel w:full h:full r:full bg:base-5" aria-label="analog clock" bind:this={clockOuter}>
	<div class="w:100% h:100%" bind:this={numsWrap}>
		{#each numerals as n (n)}
			<div
				class="numeral abs top:50% left:50% w:fit h:fit grid place-items:center f:4rem line-h:1em font-weight:700 user-select:none fg:#424242"
				class:active={h12 === n}
				style="--angle: {n * 30}deg;"
			>
				{n}
			</div>
		{/each}
	</div>

	<div bind:this={handsWrapEl} class="abs inset:0">
		<div
			class="hand z:3 w:8px h:260px bg:#F1F1F1::before"
			style="transform:translateX(-50%) rotate({hourDeg}deg);"
		></div>
		<div
			class="hand z:2 w:8px h:320px bg:#878787::before"
			style="transform:translateX(-50%) rotate({minuteDeg}deg);"
		></div>
		<div
			class="hand z:1 w:4px h:320px bg:#4E4E4E::before"
			style="transform:translateX(-50%) rotate({secondDeg}deg);"
		></div>
	</div>

	<div
		class="abs top:50% left:50% translate(-50%,-50%) w:368px square r:50% bg:base-6 z:5 flex flex:column ai:center jc:center gap:8px"
		bind:this={centerCircleEl}
	>
		{#if $pomodoroPhase !== 'idle'}
			<div
				class="flex flex:column ai:center jc:center w:206px h:79px bg:base-5 r:54px gap:2px"
				bind:this={clockWrap}
			>
				<span
					class="f:1.4rem font-weight:700 line-h:1 fg:{$pomodoroPhase === 'work'
						? 'orange-1'
						: 'blue-1'}"
				>
					{$pomodoroPhase === 'work' ? ui.work : ui.breakPhase}
				</span>
				<span class="f:2.3rem font-weight:600 fg:base-1 line-h:1 font-family:reddit-sans,sans-serif"
					>{$pomodoroTimeDisplay}</span
				>
			</div>
		{:else}
			<div class="flex flex:column gap:6px ai:center" bind:this={clockWrap}>
				<span class="f:2.5rem font-weight:500 ls:0.05em fg:base-1">{hh}:{mm}</span>
				<span class="f:1.2rem font-weight:500 fg:#777676">{dateStrLocalized}</span>
			</div>
		{/if}
		<div class="flex flex:column ai:center gap:8px" bind:this={taskCountEl}>
			<span
				class="f:10rem font-weight:700 line-h:1 fg:{countColor($pendingTasks.length)} ~color|0.5s"
			>
				{$pendingTasks.length}
			</span>
			<span class="f:2rem font-weight:700 fg:#9D9D9D ls:0.1em">Tasks</span>
		</div>
	</div>
</div>

<style>
	.numeral {
		transform: translate(-50%, -50%) rotate(var(--angle)) translateY(-300px)
			rotate(calc(-1 * var(--angle)));
		transition: color 0.4s;
	}

	.numeral.active {
		color: #eee;
	}

	.hand {
		position: absolute;
		left: 50%;
		bottom: 50%;
		transform-origin: 50% 100%;
	}

	.hand::before {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		bottom: 200px;
		border-radius: 999px;
	}
</style>
