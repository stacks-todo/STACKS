<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { pendingTasks, bubbleRadius } from '$lib/localTasks';
	import gsap from 'gsap';
	import CircleClock from '$lib/components/CircleClock.svelte';
	import { physicsRotation, modeSwitchEnabled } from '$lib/physicsController';
	import TaskCount from '$lib/components/TaskCount.svelte';
	import { usePageAnimation } from '$lib/usePageAnimation';
	import { EASE_OUT, EASE_IN } from '$lib/easings';

	const IS_PHYSICS = import.meta.env.VITE_IS_PHYSICS === 'true';

	const colorPairs: [string, string][] = [
		['#D94F45', '#B83D34'], // red   (large / close deadline)
		['#E07A3A', '#C06828'], // orange (medium)
		['#4BBFB5', '#36A89E']  // teal  (small / far deadline)
	];

	function colorPairForDate(dueDate: Date | null): [string, string] {
		if (!dueDate) return colorPairs[2];
		const d = (dueDate.getTime() - Date.now()) / 86_400_000;
		if (d < 1) return colorPairs[0];
		if (d < 7) return colorPairs[1];
		return colorPairs[2];
	}

	type StaticBubble = {
		cx: number;
		cy: number;
		r: number;
		pair: [string, string];
		angle: number;
	};

	const staticBubbles: StaticBubble[] = [
		{ cx: 34, cy: 22, r: 11, pair: colorPairs[0], angle: 130 },
		{ cx: 58, cy: 18, r: 8, pair: colorPairs[1], angle: 50 },
		{ cx: 76, cy: 26, r: 9, pair: colorPairs[1], angle: 200 },
		{ cx: 18, cy: 40, r: 8, pair: colorPairs[2], angle: 80 },
		{ cx: 46, cy: 38, r: 13, pair: colorPairs[0], angle: 160 },
		{ cx: 74, cy: 44, r: 8, pair: colorPairs[2], angle: 310 },
		{ cx: 28, cy: 58, r: 9, pair: colorPairs[1], angle: 240 },
		{ cx: 50, cy: 56, r: 10, pair: colorPairs[2], angle: 20 },
		{ cx: 72, cy: 60, r: 10, pair: colorPairs[0], angle: 100 },
		{ cx: 20, cy: 76, r: 8, pair: colorPairs[0], angle: 270 },
		{ cx: 42, cy: 78, r: 12, pair: colorPairs[1], angle: 45 },
		{ cx: 66, cy: 76, r: 9, pair: colorPairs[2], angle: 140 },
		{ cx: 34, cy: 90, r: 7, pair: colorPairs[2], angle: 190 },
		{ cx: 56, cy: 88, r: 8, pair: colorPairs[0], angle: 70 }
	];

	let CONTAINER_R = 270;
	const GRAVITY = 0.5;
	const FRICTION = 0.985;
	const RESTITUTION = 0.15;
	const RESOLVE_ITERS = 4;
	const GAP = 10;

	interface Bubble {
		x: number;
		y: number;
		vx: number;
		vy: number;
		r: number;
		angle: number;
		colorA: string;
		colorB: string;
		label: string;
	}

	let canvas: HTMLCanvasElement | null = null;
	let pageEl: HTMLDivElement | undefined = $state();
	let taskCountEl: HTMLDivElement | undefined = $state();
	let circleClockEl: HTMLDivElement | undefined = $state();
	let canvasWrap: HTMLDivElement | undefined = $state();
	let bubbles: Bubble[] = [];
	let tickerCallback: (() => void) | null = null;

	/** ハムスターホイール: 前フレームの回転値を記録してΔを計算 */
	let prevPhysicsRotation = get(physicsRotation);
	/** 接線力の倍率 (小さいほど回転の影響が小さい) */
	const HAMSTER_FACTOR = 25;

	usePageAnimation({
		animateIn(from) {
			const taskCountNode = taskCountEl?.firstElementChild as HTMLElement | null;
			const circleClockNode = circleClockEl?.firstElementChild as HTMLElement | null;
			if (from === '/table' && pageEl && taskCountNode && canvas && canvasWrap) {
				gsap.from(canvasWrap, { width: 200, height: 200, duration: 0.3, ease: EASE_OUT });
				gsap.from(canvas, { scale: 1.2, duration: 0.3, ease: EASE_OUT });
				gsap.from(taskCountNode, { y: -400, duration: 0.3, ease: EASE_OUT });
				gsap.from(pageEl, { scale: 1, duration: 0.35, ease: EASE_OUT });
			} else if (from === '/pomodoro') {
				if (canvasWrap) gsap.from(canvasWrap, { transform: 'translate(-50%,0)', duration: 0.4, ease: EASE_OUT });
			} else if (from === '/clock') {
				const tl = gsap.timeline();
				tl.from(circleClockNode, { opacity: 0, duration: 0.4, ease: EASE_OUT }, 0);
				tl.from(taskCountNode, { transform: 'translate(-50%,-130px)', duration: 0.4, ease: EASE_OUT }, 0);
				if (canvasWrap) tl.from(canvasWrap, { transform: 'translate(50%,0)', duration: 0.4, ease: EASE_OUT }, 0);
			}
		},

		animateOut(to, done) {
			// 物理シミュレーションは退場アニメ中も動かし続ける（泡が途中で固まらないように）。
			// ページ切り替え完了時に onMount の cleanup で gsap.ticker から除去される。
			const taskCountNode = taskCountEl?.firstElementChild as HTMLElement | null;
			const circleClockNode = circleClockEl?.firstElementChild as HTMLElement | null;
			if (to === '/table') {
				// done() を 0.2s で先行発火させ、ナビゲーション処理をアニメーション末尾と重ねてフリーズを隠す
				const tl = gsap.timeline();
				if (canvas) tl.to(canvas, { scale: 1.2, duration: 0.3, ease: EASE_IN }, 0);
				if (canvasWrap) tl.to(canvasWrap, { width: 200, height: 200, duration: 0.3, ease: EASE_IN }, 0);
				tl.to(taskCountNode, { y: -400, duration: 0.3, ease: EASE_IN }, 0);
				if (pageEl) tl.to(pageEl, { scale: 1, duration: 0.28, ease: EASE_IN }, 0);
				tl.call(done, [], 0.2);
				return;
			}

			if (to === '/clock') {
				const tl = gsap.timeline({ onComplete: done });
				tl.to(circleClockNode, { opacity: 0, duration: 0.2, ease: EASE_IN }, 0);
				tl.to(taskCountNode, { transform: 'translate(-50%,-100px) scale(1.2)', duration: 0.2, ease: EASE_IN }, 0);
				return;
			}

			if (to === '/pomodoro') {
				const tl = gsap.timeline({ onComplete: done });
				tl.to(taskCountNode, { duration: 0.2, ease: EASE_IN }, 0);
				return;
			}

			if (to === '/settings') {
				done();
				return;
			}

			// 未知の遷移先ではこのページ固有の animateOut を適用しない
			done();
		}
	});

	onMount(() => {
		if (!canvas) return;

		const tasks = get(pendingTasks);

		const SIZE = 525;
		CONTAINER_R = SIZE / 2;
		const dpr = window.devicePixelRatio || 1;
		canvas.width = SIZE * dpr;
		canvas.height = SIZE * dpr;
		canvas.style.width = `${SIZE}px`;
		canvas.style.height = `${SIZE}px`;

		const ctx = canvas.getContext('2d')!;
		ctx.scale(dpr, dpr);

		const CX = SIZE / 2;
		const CY = SIZE / 2;

		const scale = (CONTAINER_R * 2) / 100;

		function pickStatic(i: number): StaticBubble {
			return staticBubbles[i % staticBubbles.length];
		}

		bubbles = tasks.map((task, i) => {
			const sb = pickStatic(i);
			const x = (sb.cx - 50) * scale;
			const y = (sb.cy - 50) * scale;
			const pair = colorPairForDate(task.dueDate);

			return {
				x,
				y,
				vx: (Math.random() - 0.5) * 2,
				vy: (Math.random() - 0.5) * 2,
				r: bubbleRadius(task.dueDate),
				angle: sb.angle,
				colorA: pair[0],
				colorB: pair[1],
				label: task.title.slice(0, 5)
			};
		});

		function physicsTick() {
			// ハムスターホイール: 重力は常に下向き固定。
			// VITE_IS_PHYSICS=true かつ modeSwitchEnabled=false のとき、
			// ノブの回転量に比例した接線力をボールに加える。
			let tangentialOmega = 0;
			if (IS_PHYSICS && !get(modeSwitchEnabled)) {
				const currentRot = get(physicsRotation);
				const rotDelta = currentRot - prevPhysicsRotation;
				prevPhysicsRotation = currentRot;
				// フレームあたりのラジアン変化量
				tangentialOmega = (rotDelta * Math.PI) / 180;
			} else {
				prevPhysicsRotation = get(physicsRotation);
			}

			for (const b of bubbles) {
				// 重力は常に下向き
				b.vy += GRAVITY;

				// ハムスターホイール: 接線方向に力を加える
				// CW回転(y下正の座標系)での接線方向 = (-y/dist, x/dist)
				if (Math.abs(tangentialOmega) > 0.0001) {
					const dist = Math.hypot(b.x, b.y);
					if (dist > 0.01) {
						const tx = -b.y / dist;
						const ty = b.x / dist;
						b.vx += tx * tangentialOmega * HAMSTER_FACTOR;
						b.vy += ty * tangentialOmega * HAMSTER_FACTOR;
					}
				}

				b.vx *= FRICTION;
				b.vy *= FRICTION;
				b.x += b.vx;
				b.y += b.vy;
			}

			for (let iter = 0; iter < RESOLVE_ITERS; iter++) {
				for (let i = 0; i < bubbles.length; i++) {
					for (let j = i + 1; j < bubbles.length; j++) {
						const bi = bubbles[i];
						const bj = bubbles[j];
						const dx = bj.x - bi.x;
						const dy = bj.y - bi.y;
						const dist = Math.hypot(dx, dy);
						const minDist = bi.r + bj.r + 1.5 + GAP;
						if (dist < minDist && dist > 0.01) {
							const nx = dx / dist;
							const ny = dy / dist;
							const push = (minDist - dist) * 0.5;
							bi.x -= nx * push;
							bi.y -= ny * push;
							bj.x += nx * push;
							bj.y += ny * push;

							const rv = (bj.vx - bi.vx) * nx + (bj.vy - bi.vy) * ny;
							if (rv < 0) {
								const imp = rv * (1 + RESTITUTION) * 0.5;
								bi.vx += imp * nx;
								bi.vy += imp * ny;
								bj.vx -= imp * nx;
								bj.vy -= imp * ny;
							}
						}
					}
				}
			}

			for (const b of bubbles) {
				const dist = Math.hypot(b.x, b.y);
				const maxDist = CONTAINER_R - b.r;
				if (dist > maxDist && dist > 0.01) {
					const nx = b.x / dist;
					const ny = b.y / dist;
					b.x = nx * maxDist;
					b.y = ny * maxDist;
					const dot = b.vx * nx + b.vy * ny;
					if (dot > 0) {
						b.vx -= dot * nx * (1 + RESTITUTION);
						b.vy -= dot * ny * (1 + RESTITUTION);
					}
				}
			}
		}

		function drawHalfBubble(
			ctx: CanvasRenderingContext2D,
			x: number,
			y: number,
			r: number,
			angleDeg: number,
			colorA: string,
			colorB: string
		) {
			const a = (angleDeg * Math.PI) / 180;
			const x1 = x + r * Math.cos(a);
			const y1 = y + r * Math.sin(a);

			ctx.beginPath();
			ctx.moveTo(x1, y1);
			ctx.arc(x, y, r, a, a + Math.PI, false);
			ctx.closePath();
			ctx.fillStyle = colorA;
			ctx.fill();

			ctx.beginPath();
			ctx.moveTo(x1, y1);
			ctx.arc(x, y, r, a, a - Math.PI, true);
			ctx.closePath();
			ctx.fillStyle = colorB;
			ctx.fill();
		}

		function draw() {
			ctx.clearRect(0, 0, SIZE, SIZE);
			for (const b of bubbles) {
				const x = b.x + CX;
				const y = b.y + CY;

				drawHalfBubble(ctx, x, y, b.r, b.angle, b.colorA, b.colorB);
			}
		}

		tickerCallback = () => {
			physicsTick();
			draw();
		};
		gsap.ticker.add(tickerCallback);

		return () => {
			if (tickerCallback) gsap.ticker.remove(tickerCallback);
		};
	});
</script>

<div class="abs inset:0 flex ai:center bg:base-5 jc:center bg:base-6" bind:this={pageEl}>
	<div bind:this={canvasWrap} class="w:544px square bg:base-5 rel overflow:hidden r:50%">
		<canvas
			bind:this={canvas}
			class="bg:base-5 abs top:50% left:50% translate(-50%,-50%) w:525px square max-w:none max-h:none block"
		></canvas>
	</div>

	<div bind:this={circleClockEl}>
		<CircleClock />
	</div>

	<div bind:this={taskCountEl}>
		<TaskCount length={$pendingTasks.length} isChangeColor={false} />
	</div>
</div>
