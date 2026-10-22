/**
 * Steadies the person mask of the camera background effect over time.
 *
 * MediaPipe segments every frame on its own, so the edge of the mask jumps
 * from frame to frame with the camera's noise and small movements. This
 * blends each new mask with the previous result, by how much time has passed
 * (an exponential moving average with a time constant), so it steadies the
 * edge alike at any frame rate while still following real movement.
 *
 * It draws in the WebGL context LiveKit and MediaPipe share, and leaves the
 * state it touches as it found it.
 */

/** How long a change of the mask takes to mostly show, in milliseconds */
const TIME_CONSTANT_MS = 100;
/** The least a new mask counts, so the mask never lags far behind */
const MIN_WEIGHT = 0.2;

const VERTEX_SHADER = `#version 300 es
in vec2 position;
out vec2 uv;
void main() {
  uv = (position + 1.0) / 2.0;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec2 uv;
uniform sampler2D u_mask;
uniform sampler2D u_previous;
uniform float u_weight;
uniform bool u_invert;
out vec4 color;
void main() {
  float value = texture(u_mask, uv).r;
  if (u_invert) {
    value = 1.0 - value;
  }
  float smoothed = mix(texture(u_previous, uv).r, value, u_weight);
  color = vec4(smoothed, smoothed, smoothed, 1.0);
}`;

export default class MaskSmoother {
  private readonly program: WebGLProgram;
  private readonly vertexArray: WebGLVertexArrayObject;
  private readonly buffer: WebGLBuffer;
  private readonly uniforms: {
    mask: WebGLUniformLocation | null;
    previous: WebGLUniformLocation | null;
    weight: WebGLUniformLocation | null;
    invert: WebGLUniformLocation | null;
  };
  private textures: WebGLTexture[] = [];
  private framebuffers: WebGLFramebuffer[] = [];
  private width = 0;
  private height = 0;
  /** The texture holding the latest result */
  private current = 0;
  private lastTime?: number;

  /**
   * @param invert   The mask is the person's confidence, while the result is
   *                 the background's, as LiveKit expects
   */
  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly invert: boolean,
  ) {
    this.program = createProgram(gl);
    this.uniforms = {
      mask: gl.getUniformLocation(this.program, "u_mask"),
      previous: gl.getUniformLocation(this.program, "u_previous"),
      weight: gl.getUniformLocation(this.program, "u_weight"),
      invert: gl.getUniformLocation(this.program, "u_invert"),
    };

    const previousVertexArray = gl.getParameter(
      gl.VERTEX_ARRAY_BINDING,
    ) as WebGLVertexArrayObject | null;
    const previousBuffer = gl.getParameter(
      gl.ARRAY_BUFFER_BINDING,
    ) as WebGLBuffer | null;
    this.vertexArray = gl.createVertexArray();
    this.buffer = gl.createBuffer();
    gl.bindVertexArray(this.vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    // Two triangles covering the target
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(this.program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(previousVertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, previousBuffer);
  }

  /**
   * Blend a new mask into the result.
   *
   * @param mask    MediaPipe's confidence mask, as a texture
   * @returns The steadied mask, as a texture of the same size
   */
  update(mask: WebGLTexture, width: number, height: number): WebGLTexture {
    const gl = this.gl;
    const now = performance.now();
    let weight = 1;
    if (width !== this.width || height !== this.height) {
      this.resize(width, height);
    } else if (this.lastTime !== undefined) {
      weight = Math.max(
        MIN_WEIGHT,
        1 - Math.exp(-(now - this.lastTime) / TIME_CONSTANT_MS),
      );
    }
    this.lastTime = now;

    const saved = saveState(gl);
    const previous = this.current;
    const next = 1 - previous;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[next]);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vertexArray);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, mask);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[previous]);
    gl.uniform1i(this.uniforms.mask, 0);
    gl.uniform1i(this.uniforms.previous, 1);
    gl.uniform1f(this.uniforms.weight, weight);
    gl.uniform1i(this.uniforms.invert, this.invert ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    restoreState(gl, saved);

    this.current = next;
    return this.textures[next];
  }

  dispose(): void {
    const gl = this.gl;
    this.deleteTargets();
    gl.deleteBuffer(this.buffer);
    gl.deleteVertexArray(this.vertexArray);
    gl.deleteProgram(this.program);
  }

  private resize(width: number, height: number): void {
    const gl = this.gl;
    this.deleteTargets();
    this.width = width;
    this.height = height;
    const saved = saveState(gl);
    for (let index = 0; index < 2; index++) {
      const texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        width,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture,
        0,
      );
      this.textures.push(texture);
      this.framebuffers.push(framebuffer);
    }
    restoreState(gl, saved);
  }

  private deleteTargets(): void {
    for (const texture of this.textures) {
      this.gl.deleteTexture(texture);
    }
    for (const framebuffer of this.framebuffers) {
      this.gl.deleteFramebuffer(framebuffer);
    }
    this.textures = [];
    this.framebuffers = [];
    this.lastTime = undefined;
  }
}

interface SavedState {
  program: WebGLProgram | null;
  framebuffer: WebGLFramebuffer | null;
  vertexArray: WebGLVertexArrayObject | null;
  viewport: Int32Array;
  activeTexture: number;
  textures: (WebGLTexture | null)[];
  blend: boolean;
}

/** The state this draws with, which LiveKit and MediaPipe also use */
function saveState(gl: WebGL2RenderingContext): SavedState {
  const activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
  const textures = [gl.TEXTURE0, gl.TEXTURE1].map((unit) => {
    gl.activeTexture(unit);
    return gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  });
  return {
    program: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
    framebuffer: gl.getParameter(
      gl.FRAMEBUFFER_BINDING,
    ) as WebGLFramebuffer | null,
    vertexArray: gl.getParameter(
      gl.VERTEX_ARRAY_BINDING,
    ) as WebGLVertexArrayObject | null,
    viewport: gl.getParameter(gl.VIEWPORT) as Int32Array,
    activeTexture,
    textures,
    blend: gl.isEnabled(gl.BLEND),
  };
}

function restoreState(gl: WebGL2RenderingContext, saved: SavedState): void {
  [gl.TEXTURE0, gl.TEXTURE1].forEach((unit, index) => {
    gl.activeTexture(unit);
    gl.bindTexture(gl.TEXTURE_2D, saved.textures[index] ?? null);
  });
  gl.activeTexture(saved.activeTexture);
  gl.useProgram(saved.program);
  gl.bindFramebuffer(gl.FRAMEBUFFER, saved.framebuffer);
  gl.bindVertexArray(saved.vertexArray);
  gl.viewport(
    saved.viewport[0],
    saved.viewport[1],
    saved.viewport[2],
    saved.viewport[3],
  );
  if (saved.blend) {
    gl.enable(gl.BLEND);
  } else {
    gl.disable(gl.BLEND);
  }
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX_SHADER],
    [gl.FRAGMENT_SHADER, FRAGMENT_SHADER],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) {
      throw new Error("Unable to create a shader for the mask smoother");
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(
        `Unable to compile the mask smoother: ${gl.getShaderInfoLog(shader) ?? ""}`,
      );
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(
      `Unable to link the mask smoother: ${gl.getProgramInfoLog(program) ?? ""}`,
    );
  }
  return program;
}
