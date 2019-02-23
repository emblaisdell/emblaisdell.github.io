NUM_AIRHORNS = 5;

//SMOOTHING
AFRAME.registerComponent("listener", {
  init: function() {
    this.target = document.querySelector('#target'); // your video
    this.prevPosition = null; // initially there is no position or rotation
    this.prevRotation = null;
  },

  tick: function() {
    if (this.el.object3D.visible) {
      this.target.setAttribute('visible', 'true')

      if(!this.prevPosition && !this.prevRotation) {
        // there are no values to lerp from - set the initial values
        this.target.setAttribute('position', this.el.getAttribute('position'))
        this.target.setAttribute('rotation', this.el.getAttribute('rotation'))
      } else {
        // use the previous values to get an approximation
        this.target.object3D.position.lerp(this.prevPosition, 0.1)

        // this (below) may seem ugly, but the rotation is a euler, not a THREE.Vector3,
        // so to use the lerp function i'm doing some probably unnecessary conversions
        let rot = this.target.object3D.rotation.toVector3().lerp(this.prevRotation, 0.1)
        this.target.object3D.rotation.setFromVector3(rot)
      }
      // update the values
      this.prevPosition = this.el.object3D.position
      this.prevRotation = this.el.object3D.rotation
    } else {
     // the marker dissapeared - reset the values
     this.target.setAttribute('visible', 'false')
     this.prevPosition = null;
     this.prevRotation = null;
   }
  }
})


// MEMES
var memes = [
  {
    pos:[6,0],
    name:"sub2pewds.jpg"
  },
  {
    pos:[0,0],
    name:"iwantyou.jpg"
  },
  {
    //RESPECT
    pos:[0,-3],
    name:"pewdsdrake.jpg"
  },
  {
    pos:[-3.2,-3],
    name:"subfun.jpg"
  },
  {
    pos:[-6.4,-3],
    name:"pewds.jpg"
  },
  {
    pos:[-9.6,-3],
    name:"keepcalm.png"
  },
  {
    pos:[-9.6,0],
    name:".jpg"
  }
];


function addImage(image){
  var position = image.pos[0]+" 0 "+image.pos[1];
  console.log(position);
  $('<a-image />', {
    id: image.name+"_hiro",
    class: "",
    position: position,  // doesn't seem to do anything, known issue
    scale: "2 2 2",
    rotation: "-90 0 0",
    src: image.name,
    appendTo : $('#hiro-marker')
  });
  document.getElementById(image.name+"_hiro").setAttribute("position", position); // this does set position as a workaround
  $('<a-image />', {
    id: image.name,
    class: "",
    position: position,  // doesn't seem to do anything, known issue
    scale: "2 2 2",
    rotation: "-90 0 0",
    src: image.name,
    appendTo : $('#banner-marker')
  });
  document.getElementById(image.name).setAttribute("position", position); // this does set position as a workaround
}

var airhorns = [];
var curAirhorn = 0;
var background_music;

$(function(){
  $.each(memes,function(i,meme){
    console.log(meme);
    addImage(meme);
  });
  for(var i=0;i<NUM_AIRHORNS; i++){
    var audio = new Audio("./airhorn.mp3");
    audio.preload = "auto";
    airhorns.push(audio);
  }
  background_music = new Audio("./sandstorm.mp3");
});


/*
//cursor
var x = 0;
var y = 0;
var step = 0.1;

document.addEventListener("keydown", keyDownTextField, false);

function keyDownTextField(e) {
  var keyCode = e.keyCode;
  console.log("key press "+keyCode);
  if(keyCode==13){ // enter
    console.log("show cursor",x,y);
    $("#cursor").attr("visible","true");
  }
  if(keyCode>=37 && keyCode<=40){
    x += step*({37:-1,38:0,39:1,40:0}[keyCode]);
    y += step*({37:0,38:-1,39:0,40:1}[keyCode]);
    $("#cursor").attr("position", x + " 0 " + y);
    console.log("move",x,y);
  }
}*/

// handle click
document.addEventListener("click", handleClick, false);

function handleClick(){
  console.log("handleClick");
  $("#background_music").trigger("play");
  console.log("curAirhorn = "+curAirhorn);
  airhorns[curAirhorn].play();
  curAirhorn = (curAirhorn+1) % NUM_AIRHORNS;
  background_music.play();
}
